import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, DEFAULT_RULES, dmChannel, roomChannel, type ChatMessage, type Conversation } from '@poker/shared';
import { eq } from 'drizzle-orm';
import { chatReads } from '../../db/schema.js';
import { useTestDb } from '../db.js';
import {
  connect,
  http,
  joinAll,
  player,
  signIn,
  startServer,
  uniqueName,
  type TestClient,
  type TestServer,
} from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  server = await startServer(t.db);
});
afterAll(async () => {
  await server?.close();
});

let roomCounter = 0;
const newRoom = () => `inst-rt-${++roomCounter}`;
const memberIds = (c: TestClient) => (c.latest('lobby_state')?.members ?? []).map((m) => m.id).sort();

describe('lobby', () => {
  it('sends the lobby, chat and activity snapshots on join and keeps everyone in sync', async () => {
    const room = newRoom();
    const a = await player(server, 'Ann');
    expect(await a.send('join_room', { instanceId: room })).toEqual({ ok: true });

    const lobby = await a.state('lobby_state', (s) => s.instanceId === room);
    expect(lobby.table).toBeNull();
    expect(lobby.members).toEqual([expect.objectContaining({ id: a.id, name: a.session.me.name, presence: 'lobby', balance: 10_000 })]);
    expect(await a.next('chat_history', undefined, { since: 0 })).toEqual({ channel: roomChannel(room), messages: [] });
    expect(await a.next('activity_history', undefined, { since: 0 })).toEqual([]);

    const b = await player(server, 'Ben');
    await joinAll([b], room);
    const both = [a.id, b.id].sort();
    await a.state('lobby_state', () => memberIds(a).join() === both.join());
    await b.state('lobby_state', () => memberIds(b).join() === both.join());

    b.close();
    await a.state('lobby_state', () => memberIds(a).join() === a.id);
    a.close();
  });

  it('keeps a player present while any of their sockets is connected', async () => {
    const room = newRoom();
    const session = await signIn(server, uniqueName('Twin'));
    const tab1 = await connect(server, session);
    const tab2 = await connect(server, session);
    const watcher = await player(server, 'Watcher');
    await joinAll([tab1, tab2, watcher], room);
    await watcher.state('lobby_state', (s) => s.members.length === 2);

    tab1.close();
    // The watcher sees no change while tab2 is still here; prove it by joining a third player.
    const third = await player(server, 'Third');
    await joinAll([third], room);
    const s = await watcher.state('lobby_state', (st) => st.members.length === 3);
    expect(s.members.map((m) => m.id)).toContain(session.me.id);

    tab2.close();
    await watcher.state('lobby_state', (st) => st.members.length === 2 && !st.members.some((m) => m.id === session.me.id));
    watcher.close();
    third.close();
  });

  it('moves a player between rooms', async () => {
    const [r1, r2] = [newRoom(), newRoom()];
    const mover = await player(server, 'Mover');
    const stayer = await player(server, 'Stayer');
    await joinAll([stayer, mover], r1);
    await stayer.state('lobby_state', (s) => s.members.length === 2);

    await joinAll([mover], r2);
    await stayer.state('lobby_state', (s) => s.members.length === 1);
    await mover.state('lobby_state', (s) => s.instanceId === r2 && s.members.length === 1);

    // Room chat in r1 no longer reaches the mover.
    const mark = mover.mark();
    expect(await stayer.send('chat_send', { to: { room: true }, body: 'only r1' })).toEqual({ ok: true });
    expect(await mover.send('chat_send', { to: { room: true }, body: 'only r2' })).toEqual({ ok: true });
    await mover.next('chat_message', (m) => m.body === 'only r2', { since: mark });
    expect(mover.all('chat_message', mark).map((m) => m.body)).toEqual(['only r2']);
    mover.close();
    stayer.close();
  });

  it('rejects junk instance ids', async () => {
    const c = await player(server, 'Junk');
    for (const instanceId of ['', '   ', 'has space', '../../etc', 'x'.repeat(129), 'emoji-🃏', 'semi;colon']) {
      expect(await c.send('join_room', { instanceId }), instanceId).toEqual({ ok: false, error: 'Invalid room.' });
    }
    expect(await c.raw('join_room', { instanceId: 42 })).toEqual({ ok: false, error: 'Invalid room.' });
    expect(await c.raw('join_room', null)).toEqual({ ok: false, error: 'Invalid room.' });
    expect(await c.raw('join_room')).toEqual({ ok: false, error: 'Invalid room.' });
    expect(c.latest('lobby_state')).toBeUndefined();
    // Commands that need a room are refused.
    expect(await c.send('open_table', { rules: {} })).toEqual({ ok: false, error: 'Join the room first.' });
    expect(await c.send('chat_send', { to: { room: true }, body: 'hi' })).toEqual({ ok: false, error: 'Join the room first.' });
    expect(await c.send('watch_table')).toEqual({ ok: false, error: 'There is no table open.' });
    c.close();
  });

  it('checks instance membership when a verifier is configured', async () => {
    const verified = await startServer(t.db, { verifyInstance: async (_p, instanceId) => instanceId === 'inst-allowed' });
    try {
      const c = await player(verified, 'Verified');
      expect(await c.send('join_room', { instanceId: 'inst-other' })).toEqual({ ok: false, error: "You're not in this activity." });
      expect(await c.send('join_room', { instanceId: 'inst-allowed' })).toEqual({ ok: true });
    } finally {
      await verified.close();
    }
  });
});

describe('chat', () => {
  it('broadcasts room chat to the room and persists it', async () => {
    const room = newRoom();
    const [a, b, c] = [await player(server, 'Ava'), await player(server, 'Bo'), await player(server, 'Cy')];
    await joinAll([a, b, c], room);
    const since = [a, b, c].map((x) => x.mark());
    expect(await a.send('chat_send', { to: { room: true }, body: '  hello   room  ' })).toEqual({ ok: true });
    for (const [i, x] of [a, b, c].entries()) {
      const msg = await x.next('chat_message', (m) => m.senderId === a.id, { since: since[i] });
      expect(msg).toMatchObject({ channel: roomChannel(room), body: 'hello   room', senderName: a.session.me.name });
    }

    // Someone joining later gets it in the history.
    const d = await player(server, 'Dee');
    await joinAll([d], room);
    const history = await d.next('chat_history', undefined, { since: 0 });
    expect(history.messages.map((m) => m.body)).toEqual(['hello   room']);

    // And a present member can page it over REST.
    const rest = await http<ChatMessage[]>(server, `/messages/history?channel=${encodeURIComponent(roomChannel(room))}`, { token: b.token });
    expect(rest.status).toBe(200);
    expect(rest.body.map((m) => m.body)).toEqual(['hello   room']);
    for (const x of [a, b, c, d]) x.close();
  });

  it('delivers DMs only to the two participants and tracks unread counts', async () => {
    const room = newRoom();
    const [a, b, c] = [await player(server, 'Dma'), await player(server, 'Dmb'), await player(server, 'Dmc')];
    await joinAll([a, b, c], room);
    await b.state('me', () => true);
    const cMark = c.mark();

    expect(await a.send('chat_send', { to: { dm: b.id }, body: 'psst' })).toEqual({ ok: true });
    const channel = dmChannel(a.id, b.id);
    await a.next('chat_message', (m) => m.body === 'psst', { since: 0 });
    const got = await b.next('chat_message', (m) => m.body === 'psst', { since: 0 });
    expect(got).toMatchObject({ channel, senderId: a.id });
    await b.state('me', (m) => m.unreadMessages === 1);

    // C is in the same room: a later room message reaching C proves the DM would have arrived first.
    expect(await b.send('chat_send', { to: { room: true }, body: 'sentinel' })).toEqual({ ok: true });
    await c.next('chat_message', (m) => m.body === 'sentinel', { since: cMark });
    expect(c.log.slice(cMark).some((r) => r.raw.includes('psst'))).toBe(false);

    const convB = await http<Conversation[]>(server, '/messages/conversations', { token: b.token });
    expect(convB.status).toBe(200);
    expect(convB.body).toEqual([expect.objectContaining({ channel, unread: 1, partner: expect.objectContaining({ id: a.id }) })]);
    expect(convB.body[0].last).toMatchObject({ body: 'psst' });
    const convA = await http<Conversation[]>(server, '/messages/conversations', { token: a.token });
    expect(convA.body).toEqual([expect.objectContaining({ channel, unread: 0 })]);
    expect((await http<Conversation[]>(server, '/messages/conversations', { token: c.token })).body).toEqual([]);

    b.socket.emit('chat_read', { channel });
    await b.state('me', (m) => m.unreadMessages === 0);
    const after = await http<Conversation[]>(server, '/messages/conversations', { token: b.token });
    expect(after.body[0].unread).toBe(0);

    // Both participants can read the history; nobody else can.
    const path = `/messages/history?channel=${encodeURIComponent(channel)}`;
    expect((await http<ChatMessage[]>(server, path, { token: a.token })).body.map((m) => m.body)).toEqual(['psst']);
    expect((await http<ChatMessage[]>(server, path, { token: b.token })).status).toBe(200);
    const snoop = await http(server, path, { token: c.token });
    expect(snoop.status).toBe(403);
    expect(snoop.text).not.toContain('psst');
    for (const x of [a, b, c]) x.close();
  });

  it("lists a partner's level and equipped cosmetics with the conversation", async () => {
    const [a, b] = [await player(server, 'Framed'), await player(server, 'Reader')];
    expect(await http(server, '/shop/purchase', { token: a.token, body: { itemId: 'frame-brass', nonce: `nonce-frame-${a.id}` } }))
      .toMatchObject({ status: 200 });
    expect(await http(server, '/shop/equip', { token: a.token, body: { slot: 'frame', itemId: 'frame-brass' } }))
      .toMatchObject({ status: 200 });
    // Neither is in a room: the list alone has to carry the frame.
    expect(await a.send('chat_send', { to: { dm: b.id }, body: 'look at my frame' })).toEqual({ ok: true });
    const conv = await http<Conversation[]>(server, '/messages/conversations', { token: b.token });
    expect(conv.body[0].partner).toEqual({
      id: a.id,
      name: a.session.me.name,
      avatarUrl: expect.any(String),
      level: 1,
      cosmetics: expect.objectContaining({ frame: 'frame-brass' }),
    });
    a.close();
    b.close();
  });

  it('never broadcasts a malformed DM to the room', async () => {
    const room = newRoom();
    const [a, c] = [await player(server, 'Leaky'), await player(server, 'Listener')];
    await joinAll([a, c], room);
    const mark = c.mark();
    // Four bad targets plus the good message stay within the chat rate limit (5 per 5 s).
    for (const to of [{ dm: 123 }, { dm: { id: c.id } }, 'room', {}]) {
      const ack = await a.raw('chat_send', { to, body: 'top secret' });
      expect(ack, JSON.stringify(to)).toMatchObject({ ok: false });
    }
    expect(await a.send('chat_send', { to: { room: true }, body: 'public' })).toEqual({ ok: true });
    await c.next('chat_message', (m) => m.body === 'public', { since: mark });
    expect(c.log.slice(mark).some((r) => r.raw.includes('top secret'))).toBe(false);
    const history = await http<ChatMessage[]>(server, `/messages/history?channel=${encodeURIComponent(roomChannel(room))}`, { token: c.token });
    expect(history.body.map((m) => m.body)).toEqual(['public']);
    a.close();
    c.close();
  });

  it('only records reads for your own DMs or your room', async () => {
    const room = newRoom();
    const [a, b, c] = [await player(server, 'Ra'), await player(server, 'Rb'), await player(server, 'Rc')];
    await joinAll([a], room);
    await a.state('me', () => true);
    for (const channel of ['x'.repeat(5000), dmChannel(b.id, c.id), `dm:${a.id}`, `dm:${a.id}:${a.id}`, 'room:elsewhere', 42]) {
      a.socket.emit('chat_read', { channel } as { channel: string });
    }
    // Reads are handled in order; the valid one's `me` push means the junk was already processed.
    const mark = a.mark();
    a.socket.emit('chat_read', { channel: dmChannel(a.id, b.id) });
    await a.next('me', undefined, { since: mark });
    a.socket.emit('chat_read', { channel: roomChannel(room) });
    await a.next('me', undefined, { since: a.mark() });
    const rows = await t.db.select().from(chatReads).where(eq(chatReads.playerId, a.id));
    expect(rows.map((r) => r.channel).sort()).toEqual([dmChannel(a.id, b.id), roomChannel(room)].sort());
    for (const x of [a, b, c]) x.close();
  });

  it('refuses DMs to yourself or to nobody', async () => {
    const a = await player(server, 'Lonely');
    expect(await a.send('chat_send', { to: { dm: a.id }, body: 'me?' })).toEqual({ ok: false, error: "You can't message yourself." });
    expect(await a.send('chat_send', { to: { dm: 'mock-does-not-exist' }, body: 'hi' })).toEqual({ ok: false, error: 'That player does not exist.' });
    a.close();
  });

  it('enforces message length', async () => {
    const room = newRoom();
    const a = await player(server, 'Longwinded');
    await joinAll([a], room);
    const err = { ok: false, error: `Messages must be 1–${CHAT_MAX_LENGTH} characters.` };
    expect(await a.send('chat_send', { to: { room: true }, body: 'x'.repeat(CHAT_MAX_LENGTH + 1) })).toEqual(err);
    expect(await a.send('chat_send', { to: { room: true }, body: ' \n\t ' })).toEqual(err);
    expect(await a.raw('chat_send', { to: { room: true }, body: { text: 'hi' } })).toEqual(err);
    expect(await a.send('chat_send', { to: { room: true }, body: 'x'.repeat(CHAT_MAX_LENGTH) })).toEqual({ ok: true });
    a.close();
  });

  it('rate-limits chat to five messages in five seconds', async () => {
    const room = newRoom();
    const a = await player(server, 'Spammer');
    await joinAll([a], room);
    for (let i = 1; i <= 5; i++) expect(await a.send('chat_send', { to: { room: true }, body: `msg ${i}` })).toEqual({ ok: true });
    expect(await a.send('chat_send', { to: { room: true }, body: 'msg 6' })).toEqual({ ok: false, error: "You're sending messages too quickly." });
    a.close();
  });
});

describe('security', () => {
  it('only lets present members read a room history', async () => {
    const room = newRoom();
    const [inside, outside] = [await player(server, 'Inside'), await player(server, 'Outside')];
    await joinAll([inside], room);
    const path = `/messages/history?channel=${encodeURIComponent(roomChannel(room))}`;
    expect((await http(server, path, { token: inside.token })).status).toBe(200);
    expect((await http(server, path, { token: outside.token })).status).toBe(403);
    for (const channel of ['', 'global', 'dm:', `dm:${inside.id}`, 'room:']) {
      expect((await http(server, `/messages/history?channel=${encodeURIComponent(channel)}`, { token: inside.token })).status, channel).toBe(403);
    }
    expect((await http(server, path)).status).toBe(401);
    inside.close();
    outside.close();
  });

  it("can't read another pair's DMs", async () => {
    const [a, b, c] = [await player(server, 'Pa'), await player(server, 'Pb'), await player(server, 'Pc')];
    expect(await a.send('chat_send', { to: { dm: b.id }, body: 'between us' })).toEqual({ ok: true });
    for (const channel of [dmChannel(a.id, b.id), `dm:${b.id}:${a.id}`, `dm:${a.id}:${b.id}:${c.id}`]) {
      const r = await http(server, `/messages/history?channel=${encodeURIComponent(channel)}`, { token: c.token });
      expect(r.status, channel).toBe(403);
    }
    for (const x of [a, b, c]) x.close();
  });

  it('survives malformed command payloads', async () => {
    const room = newRoom();
    const a = await player(server, 'Fuzzer');
    await joinAll([a], room);
    expect(await a.raw('open_table', 'not-an-object')).toMatchObject({ ok: true });
    // Only known rule fields reach the table (and every viewer's payload).
    const view = await a.state('table_state', () => true);
    expect(Object.keys(view.rules).sort()).toEqual(Object.keys(DEFAULT_RULES).sort());
    expect(await a.raw('close_table')).toEqual({ ok: true });
    await a.next('table_left', undefined, { since: 0 });
    expect(await a.raw('open_table', { rules: { name: 'Junk', junk: 'x'.repeat(5000) } })).toEqual({ ok: true });
    const junk = await a.state('table_state', (v) => v.rules.name === 'Junk');
    expect(Object.keys(junk.rules).sort()).toEqual(Object.keys(DEFAULT_RULES).sort());
    expect(JSON.stringify(junk)).not.toContain('xxxxxxxx');
    expect(await a.raw('take_seat', { seat: 'zero', buyIn: 2000 })).toMatchObject({ ok: false });
    expect(await a.raw('take_seat', { seat: null, buyIn: 2000 })).toMatchObject({ ok: false });
    expect(await a.raw('take_seat', null)).toMatchObject({ ok: false });
    expect(await a.raw('act', null)).toMatchObject({ ok: false });
    expect(await a.raw('act', { type: 'raise', amount: '1e9' })).toMatchObject({ ok: false });
    expect(await a.raw('emote', {})).toMatchObject({ ok: false });
    expect(await a.raw('sit_out', 'yes')).toMatchObject({ ok: false });
    // Still healthy afterwards.
    expect(await a.send('chat_send', { to: { room: true }, body: 'still here' })).toEqual({ ok: true });
    a.close();
  });
});
