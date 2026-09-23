import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, nextButton, potTotal, progress, settledPots, startHand } from './hand.js';
import { seededRandomInt } from './deck.js';
import { play, runOn, setupHand, stacks, toAct } from './test-helpers.js';

describe('blinds and first action', () => {
  it('posts blinds left of the button and starts action left of the big blind', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 1000], ['d', 3, 1000]], buttonSeat: 0 });
    expect(h.state.smallBlindSeat).toBe(1);
    expect(h.state.bigBlindSeat).toBe(2);
    expect(toAct(h)).toBe('d');
    expect(stacks(h)).toEqual({ a: 1000, b: 975, c: 950, d: 1000 });
    expect(h.state.currentBet).toBe(50);
  });

  it('heads-up: the button posts the small blind and acts first pre-flop, last after', () => {
    const h = setupHand({ players: [['a', 3, 1000], ['b', 7, 1000]], buttonSeat: 7 });
    expect(h.state.smallBlindSeat).toBe(7);
    expect(h.state.bigBlindSeat).toBe(3);
    expect(toAct(h)).toBe('b');
    play(h, ['b', 'call'], ['a', 'check']);
    expect(h.state.street).toBe('flop');
    expect(toAct(h)).toBe('a'); // big blind acts first post-flop
  });

  it('gives the big blind the option when everyone limps', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 1000]], buttonSeat: 0 });
    play(h, ['a', 'call'], ['b', 'call']);
    expect(toAct(h)).toBe('c');
    expect(legalActions(h.state)).toMatchObject({ canCheck: true, canRaise: true, minRaiseTo: 100 });
  });

  it('uses the seat order, not the count, when a blind is all-in', () => {
    // Four players; the big blind is all-in posting. UTG (seat 3) must still act first.
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 30], ['d', 3, 1000]], buttonSeat: 0 });
    expect(h.state.players.find((p) => p.id === 'c')!.allIn).toBe(true);
    expect(toAct(h)).toBe('d');
    expect(h.state.currentBet).toBe(50); // callers still owe the full big blind
  });

  it('posts antes that do not count toward the bet', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 1000]], buttonSeat: 0, config: { ante: 10 } });
    expect(stacks(h)).toEqual({ a: 990, b: 965, c: 940 });
    expect(potTotal(h.state)).toBe(105);
    expect(legalActions(h.state)!.callAmount).toBe(50);
  });

  it('runs the board out immediately when the blinds put everyone all-in', () => {
    const h = setupHand({ players: [['a', 0, 20], ['b', 1, 40]], buttonSeat: 0, board: '2c 3d 4h 5s 9c' });
    expect(h.state.phase).toBe('dealing');
    runOn(h);
    expect(h.state.phase).toBe('complete');
    expect(h.state.board).toHaveLength(5);
    // b's uncalled 20 comes back.
    expect(h.state.result!.returned).toEqual({ b: 20 });
  });
});

describe('betting rules', () => {
  it('enforces the minimum raise and tracks the last full raise', () => {
    const h = setupHand({ players: [['a', 0, 5000], ['b', 1, 5000], ['c', 2, 5000]], buttonSeat: 0 });
    expect(applyAction(h, 'a', { type: 'raise', amount: 90 })).toMatchObject({ ok: false });
    play(h, ['a', 'raise', 200]); // raise of 150
    expect(legalActions(h.state)!.minRaiseTo).toBe(350);
    play(h, ['b', 'raise', 500]); // raise of 300
    expect(legalActions(h.state)!.minRaiseTo).toBe(800);
  });

  it('rejects out-of-turn and illegal actions', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 1000]], buttonSeat: 0 });
    expect(applyAction(h, 'b', { type: 'call' })).toEqual({ ok: false, error: "It isn't your turn." });
    expect(applyAction(h, 'a', { type: 'check' })).toMatchObject({ ok: false });
    expect(applyAction(h, 'a', { type: 'raise', amount: 150.5 })).toMatchObject({ ok: false });
  });

  it('does not reopen betting after an incomplete all-in raise', () => {
    // a bets 100 on the flop, b shoves 150 (a raise of only 50). a may call or fold, not raise.
    const h = setupHand({ players: [['a', 0, 5000], ['b', 1, 200], ['c', 2, 5000]], buttonSeat: 2 });
    // c is the button, a the small blind, b the big blind: c acts first pre-flop.
    play(h, ['c', 'call'], ['a', 'call'], ['b', 'check']);
    expect(h.state.street).toBe('flop');
    expect(toAct(h)).toBe('a');
    play(h, ['a', 'raise', 100], ['b', 'all-in']);
    expect(h.state.currentBet).toBe(150);
    // c has not acted yet: full options.
    expect(toAct(h)).toBe('c');
    expect(legalActions(h.state)!.canRaise).toBe(true);
    play(h, ['c', 'call']);
    expect(toAct(h)).toBe('a');
    expect(legalActions(h.state)).toMatchObject({ canRaise: false, callAmount: 50 });
    expect(applyAction(h, 'a', { type: 'raise', amount: 400 })).toMatchObject({ ok: false });
  });

  it('reopens betting when several short all-ins add up to a full raise', () => {
    const h = setupHand({
      players: [['a', 0, 5000], ['b', 1, 200], ['c', 2, 249], ['d', 3, 270], ['e', 4, 5000]],
      buttonSeat: 4,
    });
    // Pre-flop: everyone limps; e (button) ... order: a SB, b BB, c UTG.
    play(h, ['c', 'call'], ['d', 'call'], ['e', 'call'], ['a', 'call'], ['b', 'check']);
    expect(h.state.street).toBe('flop');
    play(h, ['a', 'raise', 100]); // a bets 100 (b has 150 behind, c 199, d 220)
    play(h, ['b', 'all-in']); // 150: +50, incomplete
    play(h, ['c', 'all-in']); // 199: +49, incomplete
    play(h, ['d', 'all-in']); // 220: +21, incomplete — but 220 is a full raise over a's 100
    play(h, ['e', 'call']);
    expect(toAct(h)).toBe('a');
    expect(legalActions(h.state)).toMatchObject({ canRaise: true, minRaiseTo: 320 });
  });

  it('turns "all-in" into a call when nobody could call a raise', () => {
    const h = setupHand({ players: [['a', 0, 300], ['b', 1, 5000]], buttonSeat: 0 });
    play(h, ['a', 'all-in']);
    expect(toAct(h)).toBe('b');
    expect(legalActions(h.state)).toMatchObject({ canRaise: false, callAmount: 250 });
    expect(applyAction(h, 'b', { type: 'all-in' })).toEqual({ ok: true });
    const b = h.state.players.find((p) => p.id === 'b')!;
    expect(b.allIn).toBe(false);
    expect(b.lastAction).toEqual({ type: 'call', amount: 300 });
  });

  it('caps a raise at what the deepest opponent can call', () => {
    const h = setupHand({ players: [['a', 0, 5000], ['b', 1, 800], ['c', 2, 600]], buttonSeat: 0 });
    const legal = legalActions(h.state)!;
    expect(legal.maxRaiseTo).toBe(800);
    expect(legal.allInTo).toBe(5000);
    play(h, ['a', 'all-in']);
    expect(h.state.players[0].stack).toBe(4200);
    expect(h.state.players[0].allIn).toBe(false);
  });

  it('labels bets, raises and all-ins', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000]], buttonSeat: 0 });
    play(h, ['a', 'call'], ['b', 'check'], ['b', 'raise', 50]);
    expect(h.state.players.find((p) => p.id === 'b')!.lastAction).toEqual({ type: 'bet', amount: 50 });
    play(h, ['a', 'raise', 200]);
    expect(h.state.players.find((p) => p.id === 'a')!.lastAction).toEqual({ type: 'raise', amount: 200 });
  });
});

describe('uncalled bets and pots', () => {
  it('returns an uncalled raise on a fold-out', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000], ['c', 2, 1000]], buttonSeat: 0 });
    play(h, ['a', 'raise', 300], ['b', 'fold'], ['c', 'fold']);
    expect(h.state.phase).toBe('complete');
    const r = h.state.result!;
    expect(r.returned).toEqual({ a: 250 });
    expect(r.payouts).toEqual({ a: 125 }); // 50 matched + 25 + 50 blinds
    expect(r.wentToShowdown).toBe(false);
    expect(stacks(h)).toEqual({ a: 1075, b: 975, c: 950 });
  });

  it('builds side pots and awards each to the best eligible hand', () => {
    const h = setupHand({
      players: [['short', 0, 100, 'Ah Ad'], ['mid', 1, 300, 'Kh Kd'], ['big', 2, 1000, 'Qh Qd']],
      buttonSeat: 2,
      board: '2c 7s 9d Jc 4h',
    });
    // Seats: short SB, mid BB, big on the button acts first. big's shove is capped
    // at 300 — the most anyone can call.
    play(h, ['big', 'all-in'], ['short', 'all-in'], ['mid', 'all-in']);
    runOn(h);
    const r = h.state.result!;
    expect(r.returned).toEqual({});
    expect(r.pots.map((p) => [p.amount, p.winnerIds])).toEqual([[300, ['short']], [400, ['mid']]]);
    expect(stacks(h)).toEqual({ short: 300, mid: 400, big: 700 });
  });

  it('splits pots and gives odd chips to the first winner left of the button', () => {
    const h = setupHand({
      players: [['a', 0, 1000, 'Ah 2d'], ['b', 1, 1000, 'As 3d'], ['c', 2, 1000, '8c 8d']],
      buttonSeat: 1,
      board: 'Kc Qd Jh 10s 4c', // a and b both make broadway
      config: { smallBlind: 25, bigBlind: 50 },
    });
    // button b(1); SB c(2); BB a(0); first to act b.
    play(h, ['b', 'call'], ['c', 'fold'], ['a', 'check']);
    play(h, ['a', 'check'], ['b', 'check'], ['a', 'check'], ['b', 'check'], ['a', 'check'], ['b', 'check']);
    const r = h.state.result!;
    // Pot 125 split two ways: 63 to a (first left of button b), 62 to b.
    expect(r.payouts).toEqual({ a: 63, b: 62 });
    expect(r.pots[0].handLabel).toBe('Straight, ace high');
  });

  it('keeps folded chips in the pot but out of eligibility', () => {
    const h = setupHand({
      players: [['a', 0, 1000, '2c 7d'], ['b', 1, 400, 'Ah Kh'], ['c', 2, 1000, 'Qs Qc']],
      buttonSeat: 0,
      board: 'Ad 5c 9s 3h 8d',
    });
    play(h, ['a', 'raise', 200], ['b', 'all-in'], ['c', 'call'], ['a', 'fold']);
    runOn(h);
    const r = h.state.result!;
    expect(r.pots.every((p) => !p.eligibleIds.includes('a'))).toBe(true);
    expect(stacks(h).b).toBe(1000); // 400 + 400 + 200 from a
    expect(stacks(h).c).toBe(600);
  });

  it('reports settled pots separately from bets in front', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000]], buttonSeat: 0 });
    play(h, ['a', 'call'], ['b', 'check']);
    expect(settledPots(h.state)).toEqual([{ amount: 100, eligibleIds: ['a', 'b'] }]);
    play(h, ['b', 'raise', 60]);
    expect(potTotal(h.state)).toBe(160);
    expect(settledPots(h.state)[0].amount).toBe(100);
  });
});

describe('showdown', () => {
  it('tables every live hand and labels the winner', () => {
    const h = setupHand({
      players: [['a', 0, 1000, 'Kh Kd'], ['b', 1, 1000, 'Ah 9c']],
      buttonSeat: 0,
      board: 'Kc 9d 2s 2h 7c',
    });
    play(h, ['a', 'call'], ['b', 'check']);
    for (let i = 0; i < 3; i++) play(h, ['b', 'check'], ['a', 'check']);
    const r = h.state.result!;
    expect(r.wentToShowdown).toBe(true);
    expect(Object.keys(r.shown).sort()).toEqual(['a', 'b']);
    expect(r.pots[0]).toMatchObject({ winnerIds: ['a'], handLabel: 'Full house, kings full of twos' });
  });
});

describe('nextButton', () => {
  it('moves clockwise to the next dealt-in seat and wraps', () => {
    expect(nextButton(null, [4, 2, 7])).toBe(2);
    expect(nextButton(2, [2, 4, 7])).toBe(4);
    expect(nextButton(7, [2, 4, 7])).toBe(2);
    expect(nextButton(5, [2, 4, 7])).toBe(7); // the old button seat left
  });
});

describe('chip conservation (randomised)', () => {
  it('never creates or destroys chips across thousands of random hands', () => {
    const random = seededRandomInt(12345);
    for (let game = 0; game < 400; game++) {
      const n = 2 + random(8);
      const players = Array.from({ length: n }, (_, i) => ({
        id: `p${i}`, seat: i, stack: 1 + random(3000),
      }));
      const before = players.reduce((s, p) => s + p.stack, 0);
      const hand = startHand({
        handNumber: 1,
        buttonSeat: players[random(n)].seat,
        players,
        config: { smallBlind: 25, bigBlind: 50, ante: random(2) ? 5 : 0 },
        random,
      });
      let guard = 0;
      while (hand.state.phase !== 'complete') {
        if (++guard > 500) throw new Error('hand did not finish');
        if (hand.state.phase === 'dealing') { progress(hand); continue; }
        const legal = legalActions(hand.state)!;
        const id = hand.state.players[hand.state.toAct!].id;
        const roll = random(10);
        let res;
        if (roll < 2) res = applyAction(hand, id, { type: 'fold' });
        else if (roll < 3) res = applyAction(hand, id, { type: 'all-in' });
        else if (roll < 5 && legal.canRaise) {
          const span = legal.maxRaiseTo - legal.minRaiseTo;
          res = applyAction(hand, id, { type: 'raise', amount: legal.minRaiseTo + random(span + 1) });
        } else res = applyAction(hand, id, { type: legal.canCheck ? 'check' : 'call' });
        expect(res.ok).toBe(true);
        if ((hand.state.phase as string) !== 'complete') {
          // Mid-hand invariant: stacks + committed chips are conserved.
          const mid = hand.state.players.reduce((s, p) => s + p.stack + p.total, 0);
          expect(mid).toBe(before);
        }
      }
      const after = hand.state.players.reduce((s, p) => s + p.stack, 0);
      expect(after).toBe(before);
      const r = hand.state.result!;
      const paid = Object.values(r.payouts).reduce((s, v) => s + v, 0);
      const potSum = r.pots.reduce((s, p) => s + p.amount, 0);
      expect(paid).toBe(potSum);
      for (const p of hand.state.players) expect(p.stack).toBeGreaterThanOrEqual(0);
    }
  });
});
