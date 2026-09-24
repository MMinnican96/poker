import { describe, expect, it } from 'vitest';
import type { HandView, SeatPlayer } from '@poker/shared';
import { FLIP_STAGGER, INITIAL_CUE_STATE, MAX_FLIPS, soundCues, suspenseRate } from './cues';
import { hand, player, view } from './testViews';

const names = (r: ReturnType<typeof soundCues>) => r.cues.map((c) => c.name);

const board3 = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }, { rank: '2', suit: 'clubs' }] as HandView['board'];
const aces = [{ rank: 'A', suit: 'hearts' }, { rank: 'A', suit: 'clubs' }] as NonNullable<SeatPlayer['holeCards']>;

describe('soundCues', () => {
  it('deals hole cards on a new hand, the flop as one cue, and single cards for the turn and river', () => {
    const ps = [player('a'), player('b')];
    expect(names(soundCues(view(null, ps), view(hand(), ps)))).toEqual(['deal']);
    const flop = hand({ street: 'flop', board: board3 });
    expect(names(soundCues(view(hand(), ps), view(flop, ps)))).toEqual(['flop']);
    const turn = hand({ street: 'turn', board: [...board3, { rank: '9', suit: 'hearts' }] });
    expect(names(soundCues(view(flop, ps), view(turn, ps)))).toEqual(['card']);
    const river = hand({ street: 'river', board: [...turn.board, { rank: '3', suit: 'hearts' }] });
    expect(names(soundCues(view(turn, ps), view(river, ps)))).toEqual(['card']);
  });

  it('treats a whole board arriving at once (all-in run-out) as the flop', () => {
    const ps = [player('a'), player('b')];
    const full = hand({ street: 'river', board: [...board3, { rank: '9', suit: 'hearts' }, { rank: '3', suit: 'hearts' }] });
    expect(names(soundCues(view(hand(), ps), view(full, ps)))).toEqual(['flop']);
  });

  it('knocks for a check, a call for a call, the muck for a fold', () => {
    const before = view(hand(), [player('a'), player('b'), player('c')]);
    const after = view(hand(), [
      player('a', { lastAction: { type: 'check', amount: 0 } }),
      player('b', { lastAction: { type: 'call', amount: 50 } }),
      player('c', { folded: true, lastAction: { type: 'fold', amount: 0 } }),
    ]);
    expect(names(soundCues(before, after))).toEqual(['check', 'call', 'fold']);
  });

  it('tells a bet, a raise and an all-in apart', () => {
    const bet = soundCues(
      view(hand({ currentBet: 0 }), [player('a'), player('b')]),
      view(hand({ currentBet: 100 }), [player('a', { lastAction: { type: 'bet', amount: 100 } }), player('b')]),
    );
    expect(names(bet)).toEqual(['bet']);
    const raise = soundCues(
      view(hand({ currentBet: 100 }), [player('a'), player('b')]),
      view(hand({ currentBet: 300 }), [player('a'), player('b', { lastAction: { type: 'raise', amount: 300 } })]),
    );
    expect(names(raise)).toEqual(['raise']);
    const shove = soundCues(
      view(hand({ currentBet: 100 }), [player('a'), player('b')]),
      view(hand({ currentBet: 1000 }), [player('a'), player('b', { allIn: true, lastAction: { type: 'all-in', amount: 1000 } })]),
    );
    expect(names(shove)).toEqual(['allin']);
  });

  it('ignores an unchanged last action', () => {
    const ps = [player('a', { lastAction: { type: 'call', amount: 50 } }), player('b')];
    expect(soundCues(view(hand(), ps), view(hand(), ps)).cues).toEqual([]);
  });

  it('builds suspense on raises in a row and resets it with a call', () => {
    const r1 = soundCues(
      view(hand(), [player('a'), player('b')]),
      view(hand({ currentBet: 150 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b')]),
      INITIAL_CUE_STATE,
    );
    expect(names(r1)).toEqual(['raise']);
    const r2 = soundCues(
      view(hand({ currentBet: 150 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b')]),
      view(hand({ currentBet: 450 }), [player('a', { lastAction: { type: 'raise', amount: 150 } }), player('b', { lastAction: { type: 'raise', amount: 450 } })]),
      r1.state,
    );
    expect(names(r2)).toEqual(['raise', 'suspense']);
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
    expect(names(r4)).toEqual(['call']);
    expect(r4.state.raiseStreak).toBe(0);
  });

  it('counts an all-in that raises towards the streak; one that only calls resets it', () => {
    const ps = [player('a', { lastAction: { type: 'raise', amount: 300 } }), player('b')];
    const raising = soundCues(
      view(hand({ currentBet: 300 }), ps),
      view(hand({ currentBet: 1000 }), [ps[0], player('b', { lastAction: { type: 'all-in', amount: 1000 } })]),
      { raiseStreak: 1 },
    );
    expect(names(raising)).toEqual(['allin', 'suspense']);
    const calling = soundCues(
      view(hand({ currentBet: 300 }), ps),
      view(hand({ currentBet: 300 }), [ps[0], player('b', { lastAction: { type: 'all-in', amount: 200 } })]),
      { raiseStreak: 1 },
    );
    expect(names(calling)).toEqual(['allin']);
    expect(calling.state.raiseStreak).toBe(0);
  });

  it('resets the streak on a new street', () => {
    const ps = [player('a'), player('b')];
    const r = soundCues(view(hand(), ps), view(hand({ street: 'flop', board: board3 }), ps), { raiseStreak: 4 });
    expect(r.state.raiseStreak).toBe(0);
  });

  it("flips when other players' cards turn face up during the hand: staggered, at most three", () => {
    const ids = ['b', 'c', 'd', 'e'];
    const r = soundCues(
      view(hand(), [player('a', { holeCards: aces }), ...ids.map((id) => player(id))]),
      view(hand(), [player('a', { holeCards: aces }), ...ids.map((id) => player(id, { holeCards: aces, hasHiddenCards: false }))]),
    );
    const flips = r.cues.filter((c) => c.name === 'flip');
    expect(flips).toHaveLength(MAX_FLIPS);
    expect(flips.map((c) => c.delay)).toEqual([0, FLIP_STAGGER, 2 * FLIP_STAGGER]);
  });

  it('flips for a card shown by choice after a fold-out, and pushes the pot after the flips', () => {
    const result = { payouts: { b: 300 }, pots: [{ amount: 300, winnerIds: ['b'], handLabel: null }], shown: {}, returned: {}, wentToShowdown: false };
    const r = soundCues(
      view(hand(), [player('a'), player('b')]),
      view(hand({ result }), [player('a'), player('b', { holeCards: aces })]),
    );
    expect(names(r)).toEqual(['flip', 'pot']);
    expect(r.cues[1].delay).toBeGreaterThan(0);
  });

  it('does not flip for your own cards, cards already showing, or a new hand', () => {
    const own = soundCues(view(hand(), [player('a'), player('b')]), view(hand(), [player('a', { holeCards: aces }), player('b')]));
    expect(names(own)).not.toContain('flip');
    const up = [player('a'), player('b', { holeCards: aces })];
    expect(names(soundCues(view(hand(), up), view(hand(), up)))).not.toContain('flip');
    const next = soundCues(view(hand(), [player('a'), player('b')]), view(hand({ handNumber: 2 }), [player('a'), player('b', { holeCards: aces })]));
    expect(names(next)).toEqual(['deal']);
  });

  it('chimes on your turn once', () => {
    const ps = [player('a'), player('b')];
    const legal = { canFold: true, canCheck: false, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000, allInTo: 1000 };
    const before = view(hand(), ps);
    const after = view(hand(), ps, { you: { ...before.you, legal } });
    expect(soundCues(before, after).cues).toEqual([{ name: 'turn' }]);
    expect(soundCues(after, after).cues).toEqual([]);
  });

  it('pushes the pot to the winner, with a fanfare only when you win', () => {
    const ps = [player('a'), player('b')];
    const theyWon = { payouts: { b: 300 }, pots: [{ amount: 300, winnerIds: ['b'], handLabel: 'Pair of aces' }], shown: {}, returned: {}, wentToShowdown: true };
    expect(names(soundCues(view(hand({ street: 'river' }), ps), view(hand({ street: 'river', result: theyWon }), ps)))).toEqual(['pot']);
    const youWon = { ...theyWon, payouts: { a: 300 }, wentToShowdown: false };
    const r = soundCues(view(hand(), ps), view(hand({ result: youWon }), ps));
    expect(names(r)).toEqual(['pot', 'win']);
    expect(r.cues[1].delay).toBeGreaterThan(0);
    // The result staying on screen plays nothing more.
    expect(soundCues(view(hand({ result: youWon }), ps), view(hand({ result: youWon }), ps)).cues).toEqual([]);
  });

  it('is silent with no hand', () => {
    expect(soundCues(null, view(null, [])).cues).toEqual([]);
  });
});
