import { describe, it, expect, vi } from 'vitest';
import type { ActivityEvent, ChatMessage, Notice } from '@poker/shared';
import { FakeSocket, makeLobby, makeMe, makeTableView } from '../test/harness';
import { ACTIVITY_KEEP, AppStore, bindSocket, createCommands, initialState, reduce } from './store';

const msg = (id: string, createdAt: string, channel = 'room:room-1', senderId = 'p2'): ChatMessage => ({
  id, channel, senderId, senderName: 'Bob', senderAvatar: '', body: `hi ${id}`, createdAt,
});
const act = (id: string, at: number): ActivityEvent => ({ id, kind: 'table', playerId: null, playerName: null, text: id, at });
const notice = (id: string): Notice => ({ id, tone: 'info', title: id });

describe('reduce', () => {
  const base = initialState(makeMe(), 'room-1');

  it('replaces me and the lobby', () => {
    const me = makeMe({ balance: 42 });
    expect(reduce(base, { type: 'me', me }).me.balance).toBe(42);
    const lobby = makeLobby();
    expect(reduce(base, { type: 'lobby_state', lobby }).lobby).toBe(lobby);
  });

  it('sets the table and the server clock offset on table_state, clears it on table_left', () => {
    const view = makeTableView({ serverNow: 10_500 });
    const s1 = reduce(base, { type: 'table_state', view, receivedAt: 10_000 });
    expect(s1.table).toBe(view);
    expect(s1.clockOffset).toBe(500);
    const s2 = reduce(s1, { type: 'table_left', reason: 'The host closed the table.' });
    expect(s2.table).toBeNull();
    expect(s2.tableLeftReason).toBe('The host closed the table.');
    expect(reduce(s2, { type: 'table_state', view, receivedAt: 10_500 }).tableLeftReason).toBeNull();
  });

  it('appends chat messages per channel without duplicates', () => {
    let s = reduce(base, { type: 'chat_message', message: msg('a', '2026-01-01T00:00:01Z') });
    s = reduce(s, { type: 'chat_message', message: msg('a', '2026-01-01T00:00:01Z') });
    s = reduce(s, { type: 'chat_message', message: msg('d', '2026-01-01T00:00:02Z', 'dm:p1:p2') });
    expect(s.chat['room:room-1'].map((m) => m.id)).toEqual(['a']);
    expect(s.chat['dm:p1:p2'].map((m) => m.id)).toEqual(['d']);
  });

  it('replaces a channel on chat_history but keeps newer live messages', () => {
    let s = reduce(base, { type: 'chat_message', message: msg('live', '2026-01-01T00:00:09Z') });
    s = reduce(s, { type: 'chat_history', channel: 'room:room-1', messages: [msg('h1', '2026-01-01T00:00:01Z'), msg('h2', '2026-01-01T00:00:02Z')] });
    expect(s.chat['room:room-1'].map((m) => m.id)).toEqual(['h1', 'h2', 'live']);
  });

  it('keeps activity newest first, deduped and capped', () => {
    let s = reduce(base, { type: 'activity_history', events: [act('old', 1), act('new', 2)] });
    expect(s.activity.map((a) => a.id)).toEqual(['new', 'old']);
    s = reduce(s, { type: 'activity', event: act('newest', 3) });
    s = reduce(s, { type: 'activity', event: act('newest', 3) });
    expect(s.activity.map((a) => a.id)).toEqual(['newest', 'new', 'old']);
    const many = Array.from({ length: ACTIVITY_KEEP + 10 }, (_, i) => act(`e${i}`, i));
    expect(reduce(base, { type: 'activity_history', events: many }).activity).toHaveLength(ACTIVITY_KEEP);
  });

  it('queues and dismisses notices', () => {
    let s = reduce(base, { type: 'notice', notice: notice('n1') });
    s = reduce(s, { type: 'notice', notice: notice('n2') });
    expect(s.notices.map((n) => n.id)).toEqual(['n1', 'n2']);
    s = reduce(s, { type: 'dismiss_notice', id: 'n1' });
    expect(s.notices.map((n) => n.id)).toEqual(['n2']);
  });
});

describe('AppStore', () => {
  it('notifies subscribers only when state changes', () => {
    const store = new AppStore(makeMe(), 'room-1');
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'notice', notice: notice('x') });
    store.dispatch({ type: 'notice', notice: notice('x') }); // duplicate: no change
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('corrects countdowns with serverNow()', () => {
    const store = new AppStore(makeMe(), 'room-1');
    store.dispatch({ type: 'table_state', view: makeTableView({ serverNow: Date.now() + 2000 }), receivedAt: Date.now() });
    expect(store.serverNow() - Date.now()).toBeGreaterThanOrEqual(1990);
  });

  it('notify() adds a local toast', () => {
    const store = new AppStore(makeMe(), 'room-1');
    const id = store.notify({ tone: 'good', title: 'Daily bonus claimed' });
    expect(store.getState().notices).toEqual([{ id, tone: 'good', title: 'Daily bonus claimed' }]);
  });
});

describe('bindSocket + commands', () => {
  function setup(connected = true) {
    const socket = new FakeSocket();
    socket.connected = connected;
    const store = new AppStore(makeMe(), 'room-1');
    const commands = createCommands(socket, store);
    const unbind = bindSocket(socket, store, commands, () => 1000);
    return { socket, store, commands, unbind };
  }

  it('joins the room and asks for table state on connect', async () => {
    const { socket, store } = setup(false);
    socket.connected = true;
    socket.serverEmit('connect');
    await vi.waitFor(() => expect(socket.events('request_state')).toHaveLength(1));
    expect(socket.events('join_room')[0].args[0]).toEqual({ instanceId: 'room-1' });
    expect(store.getState().connection).toBe('online');
  });

  it('records a refused join as a room error', async () => {
    const { socket, store } = setup(false);
    socket.respond = (event) => (event === 'join_room' ? { ok: false, error: "You're not in this activity." } : { ok: true });
    socket.connected = true;
    socket.serverEmit('connect');
    await vi.waitFor(() => expect(store.getState().roomError).toBe("You're not in this activity."));
    expect(socket.events('request_state')).toHaveLength(0);
  });

  it('routes server events into the store', () => {
    const { socket, store } = setup();
    socket.serverEmit('lobby_state', makeLobby());
    socket.serverEmit('table_state', makeTableView({ serverNow: 1500 }));
    socket.serverEmit('notice', notice('n'));
    socket.serverEmit('chat_message', msg('m', '2026-01-01T00:00:00Z'));
    const s = store.getState();
    expect(s.lobby?.instanceId).toBe('room-1');
    expect(s.table?.tableId).toBe('t1');
    expect(s.clockOffset).toBe(500);
    expect(s.notices).toHaveLength(1);
    expect(s.chat['room:room-1']).toHaveLength(1);
    socket.serverEmit('table_left', { reason: 'You left the table.' });
    expect(store.getState().table).toBeNull();
  });

  it('streams table fx to subscribers without touching state', () => {
    const { socket, store } = setup();
    const fx = vi.fn();
    const off = store.onTableFx(fx);
    const before = store.getState();
    socket.serverEmit('table_fx', { id: 'f', kind: 'emote', fromId: 'p2', value: '🔥' });
    expect(fx).toHaveBeenCalledWith({ id: 'f', kind: 'emote', fromId: 'p2', value: '🔥' });
    expect(store.getState()).toBe(before);
    off();
    socket.serverEmit('table_fx', { id: 'g', kind: 'emote', fromId: 'p2', value: '🔥' });
    expect(fx).toHaveBeenCalledTimes(1);
  });

  it('tracks connection loss and expired sessions', () => {
    const { socket, store } = setup();
    socket.serverEmit('disconnect', 'transport close');
    expect(store.getState().connection).toBe('offline');
    socket.serverEmit('connect_error', new Error('unauthorized'));
    expect(store.getState().connection).toBe('unauthorized');
  });

  it('commands emit with payloads and resolve with the ack', async () => {
    const { socket, commands } = setup();
    socket.respond = (event) => (event === 'take_seat' ? { ok: false, error: 'That seat is taken.' } : { ok: true });
    await expect(commands.takeSeat(2, 1500)).resolves.toEqual({ ok: false, error: 'That seat is taken.' });
    expect(socket.events('take_seat')[0].args[0]).toEqual({ seat: 2, buyIn: 1500 });
    await expect(commands.act({ type: 'raise', amount: 200 })).resolves.toEqual({ ok: true });
    expect(socket.events('act')[0].args[0]).toEqual({ type: 'raise', amount: 200 });
    await commands.sendChat({ dm: 'p2' }, 'hello');
    expect(socket.events('chat_send')[0].args[0]).toEqual({ to: { dm: 'p2' }, body: 'hello' });
    await commands.startTable();
    expect(socket.events('start_table')[0].args).toEqual([]);
  });

  it('turns a missing ack into a readable error', async () => {
    const { socket, commands } = setup();
    socket.respond = () => undefined;
    await expect(commands.watchTable()).resolves.toEqual({ ok: false, error: "The server didn't answer. Try again." });
  });

  it('refuses commands while offline', async () => {
    const { socket, commands } = setup();
    socket.connected = false;
    const ack = await commands.standUp();
    expect(ack.ok).toBe(false);
    expect(socket.events('stand_up')).toHaveLength(0);
  });

  it('unbinds all handlers', () => {
    const { socket, store, unbind } = setup();
    unbind();
    socket.serverEmit('lobby_state', makeLobby());
    expect(store.getState().lobby).toBeNull();
  });
});
