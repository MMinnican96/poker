import { describe, it, expect } from 'vitest';
import type { PlayerHandStat } from '@poker/shared';
import {
  emptyAggregate,
  addFact,
  addSession,
  toPlayerStatsSummary,
} from './stats-aggregate.js';

function fact(over: Partial<PlayerHandStat>): PlayerHandStat {
  return {
    gameId: 'G', playerId: 'a', handNumber: 1, seatIndex: 0, position: 0,
    chipsContributed: 0, chipsWon: 0, netResult: 0, result: 'lost',
    handCategory: null, potTotal: 0, wentToShowdown: false, vpip: false,
    pfr: false, aggressiveActions: 0, passiveActions: 0, wasAllIn: false,
    finalStreet: 'pre-flop', durationMs: 0, ...over,
  };
}

describe('aggregate reducer', () => {
  it('accumulates a won showdown hand', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({
      result: 'won', chipsContributed: 100, chipsWon: 200, netResult: 100,
      potTotal: 200, wentToShowdown: true, handCategory: 'flush',
      vpip: true, pfr: true, aggressiveActions: 2, passiveActions: 1,
    }));

    expect(agg.handsPlayed).toBe(1);
    expect(agg.handsWon).toBe(1);
    expect(agg.handsLost).toBe(0);
    expect(agg.chipsBet).toBe(100);
    expect(agg.chipsWon).toBe(200);
    expect(agg.chipsLost).toBe(0);
    expect(agg.netProfit).toBe(100);
    expect(agg.biggestPotWon).toBe(200);
    expect(agg.showdownsSeen).toBe(1);
    expect(agg.showdownsWon).toBe(1);
    expect(agg.vpipCount).toBe(1);
    expect(agg.pfrCount).toBe(1);
    expect(agg.aggressiveActions).toBe(2);
    expect(agg.passiveActions).toBe(1);
    expect(agg.categoryCounts.flush).toBe(1);
  });

  it('counts folded hands as lost with chips lost = contribution', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({ result: 'folded', chipsContributed: 25, netResult: -25 }));
    expect(agg.handsLost).toBe(1);
    expect(agg.handsWon).toBe(0);
    expect(agg.chipsLost).toBe(25);
    expect(agg.netProfit).toBe(-25);
    expect(agg.biggestPotWon).toBe(0);
  });

  it('keeps the largest won pot', () => {
    let agg = emptyAggregate();
    agg = addFact(agg, fact({ result: 'won', potTotal: 300, chipsWon: 300, netResult: 300 }));
    agg = addFact(agg, fact({ result: 'won', potTotal: 150, chipsWon: 150, netResult: 150 }));
    expect(agg.biggestPotWon).toBe(300);
  });

  it('adds session play time and games played', () => {
    let agg = emptyAggregate();
    agg = addSession(agg, 5000);
    agg = addSession(agg, 2000);
    expect(agg.totalPlayMs).toBe(7000);
    expect(agg.gamesPlayed).toBe(2);
  });
});

describe('toPlayerStatsSummary', () => {
  it('derives ratios without dividing by zero', () => {
    const summary = toPlayerStatsSummary('a', emptyAggregate());
    expect(summary.winRate).toBe(0);
    expect(summary.vpip).toBe(0);
    expect(summary.aggressionFactor).toBe(0);
    expect(summary.showdownWinRate).toBe(0);
  });

  it('computes win rate, vpip, pfr, aggression and showdown win rate', () => {
    let agg = emptyAggregate();
    agg.handsPlayed = 10;
    agg.handsWon = 4;
    agg.vpipCount = 6;
    agg.pfrCount = 3;
    agg.aggressiveActions = 8;
    agg.passiveActions = 2;
    agg.showdownsSeen = 5;
    agg.showdownsWon = 2;
    const s = toPlayerStatsSummary('a', agg);
    expect(s.winRate).toBeCloseTo(0.4);
    expect(s.vpip).toBeCloseTo(0.6);
    expect(s.pfr).toBeCloseTo(0.3);
    expect(s.aggressionFactor).toBeCloseTo(4);
    expect(s.showdownWinRate).toBeCloseTo(0.4);
  });
});
