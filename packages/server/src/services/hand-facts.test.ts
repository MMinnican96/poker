import { describe, expect, it } from 'vitest';
import { parseCards } from '@poker/shared';
import { buildHandFacts, buildHistory } from './hand-facts.js';
import { play, runOn, setupHand } from '../engine/test-helpers.js';

const TABLE = '00000000-0000-0000-0000-00000000000a';

describe('buildHandFacts', () => {
  it('records a showdown with VPIP, PFR, aggression and results', () => {
    const h = setupHand({
      players: [['a', 0, 1000, 'Ah Ad'], ['b', 1, 1000, 'Kh Kd'], ['c', 2, 1000, '2c 7d']],
      buttonSeat: 0,
      board: 'As 9c 4d 2h 3s',
    });
    // a (button) raises, b (SB) calls, c (BB) folds.
    play(h, ['a', 'raise', 150], ['b', 'call'], ['c', 'fold']);
    play(h, ['b', 'check'], ['a', 'raise', 200], ['b', 'call']);
    play(h, ['b', 'check'], ['a', 'check'], ['b', 'check'], ['a', 'check']);
    const facts = buildHandFacts({ state: h.state, tableId: TABLE, startedAt: 1000, now: 4000 });
    const by = Object.fromEntries(facts.map((f) => [f.playerId, f]));

    expect(by.a).toMatchObject({
      result: 'won', vpip: true, pfr: true, aggressiveActions: 2, passiveActions: 0,
      chipsContributed: 350, chipsWon: 750, netResult: 400, wentToShowdown: true,
      handCategory: 'three-of-a-kind', finalStreet: 'showdown', position: 0, bigBlind: 50,
      potTotal: 750, durationMs: 3000,
    });
    expect(by.b).toMatchObject({ result: 'lost', vpip: true, pfr: false, passiveActions: 2, netResult: -350, position: 1 });
    expect(by.c).toMatchObject({ result: 'folded', vpip: false, finalStreet: 'pre-flop', netResult: -50, handCategory: null });
  });

  it('treats a shove as aggressive and a call-all-in as passive', () => {
    const h = setupHand({ players: [['a', 0, 500], ['b', 1, 300]], buttonSeat: 0 });
    play(h, ['a', 'all-in'], ['b', 'call']); // a's shove is capped at b's 300
    runOn(h);
    const facts = buildHandFacts({ state: h.state, tableId: TABLE, startedAt: 0, now: 0 });
    expect(facts.find((f) => f.playerId === 'a')).toMatchObject({ aggressiveActions: 1, pfr: true });
    expect(facts.find((f) => f.playerId === 'b')).toMatchObject({ aggressiveActions: 0, passiveActions: 1, wasAllIn: true });
  });
});

describe('buildHandFacts: achievement fields', () => {
  const by = (h: ReturnType<typeof setupHand>) =>
    Object.fromEntries(buildHandFacts({ state: h.state, tableId: TABLE, startedAt: 0, now: 0 }).map((f) => [f.playerId, f]));

  it('spots a three-bet and a check-raise, and keeps cards, board and starting stacks', () => {
    const h = setupHand({
      players: [['a', 0, 1000, 'Ah Kd'], ['b', 1, 1000, 'Qc Qs']],
      buttonSeat: 0,
      board: '2c 7d 9h Ks 3s',
    });
    play(h, ['a', 'raise', 150], ['b', 'raise', 450], ['a', 'call']); // b three-bets
    play(h, ['b', 'check'], ['a', 'raise', 100], ['b', 'raise', 300], ['a', 'call']); // b check-raises the flop
    play(h, ['b', 'check'], ['a', 'check'], ['b', 'check'], ['a', 'check']);
    const f = by(h);
    expect(f.b).toMatchObject({ threeBet: true, checkRaise: true, startingStack: 1000, playersDealt: 2, allInPreflop: false });
    expect(f.a).toMatchObject({ threeBet: false, checkRaise: false, startingStack: 1000, pfr: true });
    expect(f.a.holeCards).toEqual(parseCards('Ah Kd'));
    expect(f.b.board).toEqual(parseCards('2c 7d 9h Ks 3s'));
    expect(f.a.showdownOpponents).toBe(1);
  });

  it('counts players busted in pots the winner took, and all-ins made by a blind', () => {
    const h = setupHand({
      players: [['a', 0, 5000, 'Ah Ad'], ['b', 1, 25, '7c 2d'], ['c', 2, 40, '8s 3h']],
      buttonSeat: 0,
      board: 'Ks Qd 9c 5h Jd',
    });
    play(h, ['a', 'call']); // b's small blind and c's short big blind put them all in
    runOn(h);
    const f = by(h);
    // a called the blinds' all-ins and stayed in, so a was in a pre-flop all-in too.
    expect(f.a).toMatchObject({ result: 'won', knockouts: 2, allInPreflop: true, startingStack: 5000, showdownOpponents: 2 });
    expect(f.b).toMatchObject({ result: 'lost', knockouts: 0, allInPreflop: true, startingStack: 25 });
    expect(f.c).toMatchObject({ result: 'lost', knockouts: 0, allInPreflop: true, startingStack: 40 });
  });

  it('credits a knockout only for busted players eligible for a pot the player won', () => {
    // b (100) and a (600) are busted; c wins the main and first side pot, d wins the last side pot.
    const h = setupHand({
      players: [['a', 0, 600, 'Qh Qd'], ['b', 1, 100, '8h 6d'], ['c', 2, 300, 'Kc Kd'], ['d', 3, 1000, 'Ah Ad']],
      buttonSeat: 0,
      board: '2c 7d 9h Ks 3s',
    });
    play(h, ['d', 'raise', 600], ['a', 'all-in'], ['b', 'all-in'], ['c', 'all-in']);
    runOn(h);
    const f = by(h);
    expect(h.state.result!.pots.map((p) => [p.eligibleIds.slice().sort().join(''), p.winnerIds.join('')])).toEqual([
      ['abcd', 'c'], ['acd', 'c'], ['ad', 'd'],
    ]);
    expect(f.d).toMatchObject({ result: 'won', knockouts: 1 }); // a only: b wasn't in the pot d won
    expect(f.c).toMatchObject({ result: 'won', knockouts: 2 });
    expect(f.a).toMatchObject({ result: 'lost', knockouts: 0 });
  });

  it('counts a check-raise made with an all-in that raises', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 500]], buttonSeat: 0, board: '2c 7d 9h Ks 3s' });
    play(h, ['a', 'call'], ['b', 'check']);
    play(h, ['b', 'check'], ['a', 'raise', 100], ['b', 'all-in'], ['a', 'call']);
    runOn(h);
    const f = by(h);
    expect(h.state.log.some((e) => e.type === 'action' && e.playerId === 'b' && e.street === 'flop' && e.action === 'all-in')).toBe(true);
    expect(f.b).toMatchObject({ checkRaise: true, wasAllIn: true });
    expect(f.a).toMatchObject({ checkRaise: false });
  });

  it('works out the starting stack when an uncalled bet comes back', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 700]], buttonSeat: 0 });
    play(h, ['a', 'raise', 400], ['b', 'fold']);
    expect(h.state.log.some((e) => e.type === 'uncalled' && e.playerId === 'a')).toBe(true);
    const f = by(h);
    expect(f.a).toMatchObject({ startingStack: 1000, chipsContributed: 50, netResult: 50 });
    expect(f.b).toMatchObject({ startingStack: 700, netResult: -50 });
  });

  describe('allInPreflop', () => {
    it('credits the shover and the player who calls the shove', () => {
      // a (small blind) calls, b shoves from the big blind, a calls.
      const h = setupHand({ players: [['a', 0, 1000, 'Ah Ad'], ['b', 1, 300, 'Kh Kd']], buttonSeat: 0, board: '2c 7d 9h 5s 3s' });
      play(h, ['a', 'call'], ['b', 'all-in'], ['a', 'call']);
      runOn(h);
      const f = by(h);
      expect(h.state.log.some((e) => e.type === 'action' && e.playerId === 'b' && e.action === 'all-in')).toBe(true);
      expect(f.b).toMatchObject({ allInPreflop: true });
      expect(f.a).toMatchObject({ allInPreflop: true, result: 'won', wentToShowdown: true });
    });

    it('credits the player who covers a short stack: the engine logs that shove as a raise', () => {
      const h = setupHand({ players: [['a', 0, 1000, 'Ah Ad'], ['b', 1, 300, 'Kh Kd']], buttonSeat: 0, board: '2c 7d 9h 5s 3s' });
      play(h, ['a', 'all-in'], ['b', 'call']);
      runOn(h);
      const f = by(h);
      const aShove = h.state.log.find((e) => e.type === 'action' && e.playerId === 'a');
      expect(aShove).toMatchObject({ action: 'raise', to: 300 });
      expect(f.a).toMatchObject({ allInPreflop: true, result: 'won', wasAllIn: false });
      expect(f.b).toMatchObject({ allInPreflop: true, wasAllIn: true });
    });

    it('leaves out players who fold to the shove or fold later', () => {
      const h = setupHand({
        players: [['a', 0, 100], ['b', 1, 1000], ['c', 2, 1000], ['d', 3, 1000]],
        buttonSeat: 3,
      });
      // d has the button: a posts the small blind, b the big blind, c acts first.
      play(h, ['c', 'fold'], ['d', 'call'], ['a', 'all-in'], ['b', 'call'], ['d', 'call']);
      play(h, ['b', 'raise', 200], ['d', 'fold']);
      runOn(h);
      const f = by(h);
      expect(f.a).toMatchObject({ allInPreflop: true });
      expect(f.b).toMatchObject({ allInPreflop: true });
      expect(f.c).toMatchObject({ allInPreflop: false }); // folded before the shove
      expect(f.d).toMatchObject({ allInPreflop: false }); // called it, then folded the flop
    });

    it('is false when nobody is all-in pre-flop', () => {
      const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 300]], buttonSeat: 0 });
      play(h, ['a', 'call'], ['b', 'check']);
      play(h, ['b', 'all-in'], ['a', 'call']);
      runOn(h);
      const f = by(h);
      expect(f.a.allInPreflop).toBe(false);
      expect(f.b.allInPreflop).toBe(false);
    });
  });

  it('flags a player behind on the turn who wins at showdown', () => {
    const h = setupHand({
      players: [['a', 0, 1000, 'Ah Ad'], ['b', 1, 1000, 'Kh Kd']],
      buttonSeat: 0,
      board: '2c 7d 9s 3h Ks',
    });
    play(h, ['a', 'call'], ['b', 'check']);
    for (let street = 0; street < 3; street++) play(h, ['b', 'check'], ['a', 'check']);
    const f = by(h);
    expect(f.b).toMatchObject({ result: 'won', behindOnTurn: true, splitPot: false });
    expect(f.a).toMatchObject({ result: 'lost', behindOnTurn: false });
  });

  it('flags a split pot for every winner', () => {
    const h = setupHand({
      players: [['a', 0, 1000, '2c 3d'], ['b', 1, 1000, '2d 3c']],
      buttonSeat: 0,
      board: 'Ah Kh Qh Jh Th',
    });
    play(h, ['a', 'call'], ['b', 'check']);
    for (let street = 0; street < 3; street++) play(h, ['b', 'check'], ['a', 'check']);
    const f = by(h);
    expect(f.a).toMatchObject({ splitPot: true, result: 'won', netResult: 0, handCategory: 'royal-flush', behindOnTurn: false });
    expect(f.b).toMatchObject({ splitPot: true, result: 'won' });
  });

  it('leaves showdown-only fields empty on a fold-out', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000]], buttonSeat: 0 });
    play(h, ['a', 'raise', 200], ['b', 'fold']);
    const f = by(h);
    expect(f.a).toMatchObject({ showdownOpponents: 0, behindOnTurn: false, splitPot: false, knockouts: 0, board: [] });
  });
});

describe('buildHistory', () => {
  it('stores cards, nets and whether each hand was shown', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000]], buttonSeat: 0 });
    play(h, ['a', 'raise', 200], ['b', 'fold']);
    const rec = buildHistory(h.state, TABLE);
    expect(rec.players.map((p) => [p.id, p.net, p.shown, p.result])).toEqual([
      ['a', 50, false, 'won'],
      ['b', -50, false, 'folded'],
    ]);
    expect(rec.pots).toEqual([{ amount: 100, winnerIds: ['a'], handLabel: null }]);
    expect(rec.players.map((p) => p.cardBack)).toEqual([undefined, undefined]);
  });

  it('records the card back each player had equipped', () => {
    const h = setupHand({ players: [['a', 0, 1000], ['b', 1, 1000]], buttonSeat: 0 });
    play(h, ['a', 'raise', 200], ['b', 'fold']);
    const rec = buildHistory(h.state, TABLE, { a: 'back-navy', b: 'back-classic' });
    expect(rec.players.map((p) => [p.id, p.cardBack])).toEqual([['a', 'back-navy'], ['b', 'back-classic']]);
  });
});
