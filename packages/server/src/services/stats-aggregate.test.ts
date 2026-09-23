import { describe, it, expect } from 'vitest';
import type { PlayerHandStat } from '@poker/shared';
import { emptyAggregate, addFact, addSession, toPlayerStatsSummary } from './stats-aggregate.js';

export function fact(over: Partial<PlayerHandStat> = {}): PlayerHandStat {
  return {
    tableId: '00000000-0000-0000-0000-000000000001', playerId: 'a', handNumber: 1, seat: 0, position: 0,
    bigBlind: 50, chipsContributed: 0, chipsWon: 0, netResult: 0, result: 'lost',
    handCategory: null, potTotal: 0, wentToShowdown: false, vpip: false,
    pfr: false, aggressiveActions: 0, passiveActions: 0, wasAllIn: false,
    finalStreet: 'pre-flop', durationMs: 0, ...over,
  };
}

describe('aggregate reducer', () => {
  it('accumulates a won showdown hand', () => {
    const agg = addFact(emptyAggregate(), fact({
      result: 'won', chipsContributed: 100, chipsWon: 200, netResult: 100,
      potTotal: 200, wentToShowdown: true, handCategory: 'flush', finalStreet: 'showdown',
      vpip: true, pfr: true, aggressiveActions: 2, passiveActions: 1,
    }));
    expect(agg).toMatchObject({
      handsPlayed: 1, handsWon: 1, handsLost: 0, chipsBet: 100, chipsWon: 200, chipsLost: 0,
      netProfit: 100, biggestPotWon: 200, showdownsSeen: 1, showdownsWon: 1, flopsSeen: 1,
      vpipCount: 1, pfrCount: 1, aggressiveActions: 2, passiveActions: 1,
      categoryCounts: { flush: 1 },
    });
  });

  it('counts a pre-flop fold as a loss without a flop seen', () => {
    const agg = addFact(emptyAggregate(), fact({ result: 'folded', chipsContributed: 25, netResult: -25 }));
    expect(agg).toMatchObject({ handsLost: 1, chipsLost: 25, netProfit: -25, flopsSeen: 0 });
  });

  it('does not mutate its input and records sessions', () => {
    const base = emptyAggregate();
    const next = addSession(base, 60_000);
    expect(base.sessionsPlayed).toBe(0);
    expect(next).toMatchObject({ sessionsPlayed: 1, totalPlayMs: 60_000 });
  });

  it('derives ratios at read time', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({ result: 'won', chipsWon: 100, netResult: 100, vpip: true, aggressiveActions: 3, passiveActions: 1 }));
    agg = addFact(agg, fact({ result: 'lost', wentToShowdown: true, netResult: -50 }));
    const s = toPlayerStatsSummary('a', agg);
    expect(s.winRate).toBe(0.5);
    expect(s.vpip).toBe(0.5);
    expect(s.aggressionFactor).toBe(3);
    expect(s.showdownWinRate).toBe(0);
    expect(toPlayerStatsSummary('a', emptyAggregate()).winRate).toBe(0);
  });
});
