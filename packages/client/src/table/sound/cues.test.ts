import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS, DEFAULT_RULES, type HandView, type SeatPlayer, type TableView } from '@poker/shared';
import { INITIAL_CUE_STATE, soundCues, suspenseRate } from './cues';

function player(id: string, patch: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id, name: id, avatarUrl: '', level: 1, cosmetics: DEFAULT_COSMETICS, stack: 1000, state: 'playing', connected: true,
    inHand: true, folded: false, allIn: false, committed: 0, holeCards: null, hasHiddenCards: true, lastAction: null,
    pending: null, sittingOut: false, pendingTopUp: 0, ...patch,
  };
}

function hand(patch: Partial<HandView> = {}): HandView {
  return {
    handNumber: 1, street: 'pre-flop', board: [], pots: [], potTotal: 75, buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 2,
    toActSeat: 0, actionStartedAt: null, actionEndsAt: null, currentBet: 50, result: null, ...patch,
  };
}

function view(h: HandView | null, players: SeatPlayer[], patch: Partial<TableView> = {}): TableView {
  return {
    tableId: 't', instanceId: 'r', rules: DEFAULT_RULES, status: 'running', hostId: 'a',
    seats: players.map((p, seat) => ({ seat, player: p })), spectators: [], hand: h, handsDealt: 1, closing: false,
    you: { id: 'a', role: 'seated', seat: 0, bankroll: 0, pending: null, sittingOut: false, pendingTopUp: 0, legal: null, emotes: [] },
    serverNow: 0, ...patch,
  };
}

const names = (r: ReturnType<typeof soundCues>) => r.cues.map((c) => c.name);

describe('soundCues', () => {
  it('deals on a new hand and on each new street', () => {
    const ps = [player('a'), player('b')];
    expect(names(soundCues(view(null, ps), view(hand(), ps)))).toEqual(['deal']);
    const flop = hand({ street: 'flop', board: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }, { rank: '2', suit: 'clubs' }] });
    expect(names(soundCues(view(hand(), ps), view(flop, ps)))).toEqual(['deal']);
  });

  it('knocks for a check, chips for a call, a fold sound for a fold', () => {
    const before = view(hand(), [player('a'), player('b'), player('c')]);
    const after = view(hand(), [
      player('a', { lastAction: { type: 'check', amount: 0 } }),
      player('b', { lastAction: { type: 'call', amount: 50 } }),
      player('c', { folded: true, lastAction: { type: 'fold', amount: 0 } }),
    ]);
    expect(names(soundCues(before, after))).toEqual(['check', 'bet', 'fold']);
  });

  it('ignores an unchanged last action', () => {
    const ps = [player('a', { lastAction: { type: 'call', amount: 50 } }), player('b')];
    expect(soundCues(view(hand(), ps), view(hand(), ps)).cues).toEqual([]);
  });

  it('builds suspense on raises in a row and resets it with a call', () => {
    const ps0 = [player('a'), player('b')];
    let s = INITIAL_CUE_STATE;
    const r1 = soundCues(view(hand(), ps0), view(hand({ currentBet: 150 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b')]), s);
    expect(names(r1)).toEqual(['bet']);
    s = r1.state;
    const r2 = soundCues(
      view(hand({ currentBet: 150 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b')]),
      view(hand({ currentBet: 450 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b', { lastAction: { type: 'raise', amount: 450 } })]),
      s,
    );
    expect(names(r2)).toEqual(['bet', 'suspense']);
    expect(r2.cues[1].rate).toBe(suspenseRate(2));
    const r3 = soundCues(
      view(hand({ currentBet: 450 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b', { lastAction: { type: 'raise', amount: 450 } })]),
      view(hand({ currentBet: 1350 }), [player('a', { lastAction: { type: 'raise', amount: 1350 } }), player('b', { lastAction: { type: 'raise', amount: 450 } })]),
      r2.state,
    );
    expect(r3.cues[1]).toEqual({ name: 'suspense', rate: suspenseRate(3) });
    expect(suspenseRate(3)).toBeGreaterThan(suspenseRate(2));
    const r4 = soundCues(
      view(hand({ currentBet: 1350 }), [player('a', { lastAction: { type: 'raise', amount: 1350 } }), player('b', { lastAction: { type: 'raise', amount: 450 } })]),
      view(hand({ currentBet: 1350 }), [player('a', { lastAction: { type: 'raise', amount: 1350 } }), player('b', { lastAction: { type: 'call', amount: 1350 } })]),
      r3.state,
    );
    expect(names(r4)).toEqual(['bet']);
    expect(r4.state.raiseStreak).toBe(0);
  });

  it('resets the streak on a new street', () => {
    const ps = [player('a'), player('b')];
    const r = soundCues(view(hand(), ps), view(hand({ street: 'flop', board: [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' }, { rank: '4', suit: 'clubs' }] }), ps), { raiseStreak: 4 });
    expect(r.state.raiseStreak).toBe(0);
  });

  it('cues your turn once, quietly', () => {
    const ps = [player('a'), player('b')];
    const legal = { canFold: true, canCheck: false, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000, allInTo: 1000 };
    const before = view(hand(), ps);
    const after = view(hand(), ps, { you: { ...before.you, legal } });
    const r = soundCues(before, after);
    expect(r.cues).toEqual([{ name: 'check', rate: 1.5, gain: 0.35 }]);
    expect(soundCues(after, after).cues).toEqual([]);
  });

  it('plays the win sound when a showdown result arrives', () => {
    const ps = [player('a'), player('b')];
    const result = { payouts: { b: 300 }, pots: [{ amount: 300, winnerIds: ['b'], handLabel: 'Pair of aces' }], shown: {}, returned: {}, wentToShowdown: true };
    expect(names(soundCues(view(hand({ street: 'river' }), ps), view(hand({ street: 'river', result }), ps)))).toContain('win');
    // A fold-out someone else won is quiet.
    const foldOut = { ...result, wentToShowdown: false };
    expect(names(soundCues(view(hand(), ps), view(hand({ result: foldOut }), ps)))).not.toContain('win');
  });

  it('is silent with no hand', () => {
    expect(soundCues(null, view(null, [])).cues).toEqual([]);
  });
});
