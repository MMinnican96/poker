import { describe, expect, it } from 'vitest';
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
  });
});
