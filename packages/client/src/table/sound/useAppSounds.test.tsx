import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, HandView, SeatPlayer, TableView } from '@poker/shared';
import { ClientProvider } from '../../app/client';
import { makeClient } from '../../test/harness';
import type { SoundManager } from './SoundManager';
import { resetSoundSettings, setTimerTicks } from './soundStore';
import { hand, LEGAL, player, view } from './testViews';
import { useAppSounds } from './useAppSounds';

const ROOM = 'room:room-1';
const DM = 'dm:p1:p2';
const msg = (id: string, minute: number, senderId = 'p2', channel = ROOM): ChatMessage => ({
  id, channel, senderId, senderName: senderId, senderAvatar: '', body: id,
  createdAt: new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString(),
});

function setup() {
  const { client } = makeClient();
  const played: string[] = [];
  const manager: SoundManager = { unlock: vi.fn(), setSettings: vi.fn(), play: (n) => void played.push(n) };
  const wrapper = ({ children }: { children: ReactNode }) => <ClientProvider client={client}>{children}</ClientProvider>;
  const hook = renderHook(() => useAppSounds(manager), { wrapper });
  return { ...hook, store: client.store, played, me: client.store.getState().me.id };
}

describe('useAppSounds', () => {
  it('pops for a room message or DM from someone else', () => {
    const { store, played } = setup();
    act(() => store.dispatch({ type: 'chat_message', message: msg('a', 1) }));
    expect(played).toEqual(['message']);
    act(() => store.dispatch({ type: 'chat_message', message: msg('d', 2, 'p2', DM) }));
    expect(played).toEqual(['message', 'message']);
  });

  it('stays quiet for your own messages and for history loading in', () => {
    const { store, played, me } = setup();
    act(() => store.dispatch({ type: 'chat_message', message: msg('mine', 1, me) }));
    act(() => store.dispatch({ type: 'chat_history', channel: ROOM, messages: [msg('h1', 0), msg('h2', 0)] }));
    act(() => store.dispatch({ type: 'chat_history', channel: DM, messages: [msg('h3', 0, 'p2', DM)] }));
    expect(played).toEqual([]);
    // A duplicate delivery of a known message changes nothing.
    act(() => store.dispatch({ type: 'chat_message', message: msg('h2', 0) }));
    expect(played).toEqual([]);
  });

  it('chimes for good news only', () => {
    const { store, played } = setup();
    act(() => store.dispatch({ type: 'notice', notice: { id: 'n1', tone: 'good', title: 'Level 5!' } }));
    expect(played).toEqual(['achievement']);
    act(() => store.dispatch({ type: 'notice', notice: { id: 'n2', tone: 'bad', title: 'Nope' } }));
    act(() => store.dispatch({ type: 'notice', notice: { id: 'n3', tone: 'info', title: 'FYI' } }));
    act(() => store.dispatch({ type: 'dismiss_notice', id: 'n1' }));
    expect(played).toEqual(['achievement']);
  });

  it('stops listening on unmount', () => {
    const { store, played, unmount } = setup();
    unmount();
    act(() => store.dispatch({ type: 'chat_message', message: msg('a', 1) }));
    expect(played).toEqual([]);
  });
});

/** A table view as p1 (the harness's you) sees it. */
function tableView(h: HandView | null, players: SeatPlayer[], patch: Partial<TableView> = {}): TableView {
  const v = view(h, players, patch);
  return { ...v, you: { ...v.you, id: 'p1', ...patch.you } };
}

describe('useAppSounds: the table', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetSoundSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const seated = () => [player('p1'), player('p2')];
  const show = (store: ReturnType<typeof setup>['store'], v: TableView) =>
    act(() => store.dispatch({ type: 'table_state', view: v, receivedAt: Date.now() }));

  it('takes the first view as a baseline, then plays each change', () => {
    const { store, played } = setup();
    show(store, tableView(hand(), [player('p1'), player('p2', { lastAction: { type: 'raise', amount: 100 } })]));
    expect(played).toEqual([]);
    show(store, tableView(hand(), [player('p1'), player('p2', { lastAction: { type: 'call', amount: 100 } })]));
    expect(played).toEqual(['call']);
  });

  it('takes the first view after the table was gone as a new baseline (reconnect)', () => {
    const { store, played } = setup();
    show(store, tableView(hand(), seated()));
    act(() => store.dispatch({ type: 'table_left', left: { code: 'left', reason: '' } }));
    show(store, tableView(hand({ handNumber: 7 }), [player('p1'), player('p2', { lastAction: { type: 'bet', amount: 50 } })]));
    expect(played).toEqual([]);
    show(store, tableView(hand({ handNumber: 8 }), seated()));
    expect(played).toEqual(['deal']);
  });

  it("chimes and ticks for your turn from the store's clock, whatever section is showing", () => {
    const { store, played } = setup();
    show(store, tableView(hand(), seated()));
    // The server clock runs 4 s ahead; your deadline is 6 s from the server's now.
    const serverNow = Date.now() + 4_000;
    const turn = tableView(hand({ actionEndsAt: serverNow + 6_000, toActSeat: 0 }), seated(), { serverNow });
    show(store, { ...turn, you: { ...turn.you, legal: LEGAL } });
    expect(played).toEqual(['turn']);
    vi.advanceTimersByTime(999);
    expect(played).toEqual(['turn']);
    vi.advanceTimersByTime(1);
    expect(played).toEqual(['turn', 'tick']);
    act(() => setTimerTicks(false));
    vi.advanceTimersByTime(10_000);
    expect(played).toEqual(['turn', 'tick']);
  });
});
