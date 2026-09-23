import type { HandCategory, PlayerHandStat, PlayerStatsSummary } from '@poker/shared';

/** Accumulator mirroring the numeric columns of player_stats. */
export interface AggregateState {
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  chipsBet: number;
  chipsWon: number;
  chipsLost: number;
  netProfit: number;
  biggestPotWon: number;
  showdownsWon: number;
  showdownsSeen: number;
  flopsSeen: number;
  vpipCount: number;
  pfrCount: number;
  aggressiveActions: number;
  passiveActions: number;
  categoryCounts: Record<string, number>;
  totalPlayMs: number;
  sessionsPlayed: number;
}

export function emptyAggregate(): AggregateState {
  return {
    handsPlayed: 0, handsWon: 0, handsLost: 0,
    chipsBet: 0, chipsWon: 0, chipsLost: 0, netProfit: 0,
    biggestPotWon: 0, showdownsWon: 0, showdownsSeen: 0, flopsSeen: 0,
    vpipCount: 0, pfrCount: 0, aggressiveActions: 0, passiveActions: 0,
    categoryCounts: {}, totalPlayMs: 0, sessionsPlayed: 0,
  };
}

/** Fold one hand fact into the accumulator. Pure. */
export function addFact(agg: AggregateState, fact: PlayerHandStat): AggregateState {
  const won = fact.result === 'won';
  const next: AggregateState = {
    ...agg,
    categoryCounts: { ...agg.categoryCounts },
    handsPlayed: agg.handsPlayed + 1,
    handsWon: agg.handsWon + (won ? 1 : 0),
    handsLost: agg.handsLost + (won ? 0 : 1),
    chipsBet: agg.chipsBet + fact.chipsContributed,
    chipsWon: agg.chipsWon + fact.chipsWon,
    chipsLost: agg.chipsLost + (fact.netResult < 0 ? -fact.netResult : 0),
    netProfit: agg.netProfit + fact.netResult,
    biggestPotWon: won ? Math.max(agg.biggestPotWon, fact.chipsWon) : agg.biggestPotWon,
    showdownsSeen: agg.showdownsSeen + (fact.wentToShowdown ? 1 : 0),
    showdownsWon: agg.showdownsWon + (fact.wentToShowdown && won ? 1 : 0),
    flopsSeen: agg.flopsSeen + (fact.finalStreet !== 'pre-flop' ? 1 : 0),
    vpipCount: agg.vpipCount + (fact.vpip ? 1 : 0),
    pfrCount: agg.pfrCount + (fact.pfr ? 1 : 0),
    aggressiveActions: agg.aggressiveActions + fact.aggressiveActions,
    passiveActions: agg.passiveActions + fact.passiveActions,
  };
  if (fact.handCategory && fact.wentToShowdown) {
    next.categoryCounts[fact.handCategory] = (next.categoryCounts[fact.handCategory] ?? 0) + 1;
  }
  return next;
}

/** Fold one table session's play time into the accumulator. */
export function addSession(agg: AggregateState, playMs: number): AggregateState {
  return { ...agg, totalPlayMs: agg.totalPlayMs + playMs, sessionsPlayed: agg.sessionsPlayed + 1 };
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** Read-facing summary with ratios derived at read time (never stored). */
export function toPlayerStatsSummary(playerId: string, agg: AggregateState): PlayerStatsSummary {
  return {
    playerId,
    handsPlayed: agg.handsPlayed,
    handsWon: agg.handsWon,
    handsLost: agg.handsLost,
    chipsBet: agg.chipsBet,
    chipsWon: agg.chipsWon,
    netProfit: agg.netProfit,
    biggestPotWon: agg.biggestPotWon,
    showdownsWon: agg.showdownsWon,
    showdownsSeen: agg.showdownsSeen,
    flopsSeen: agg.flopsSeen,
    vpipCount: agg.vpipCount,
    pfrCount: agg.pfrCount,
    aggressiveActions: agg.aggressiveActions,
    passiveActions: agg.passiveActions,
    categoryCounts: agg.categoryCounts as Partial<Record<HandCategory, number>>,
    totalPlayMs: agg.totalPlayMs,
    sessionsPlayed: agg.sessionsPlayed,
    winRate: ratio(agg.handsWon, agg.handsPlayed),
    vpip: ratio(agg.vpipCount, agg.handsPlayed),
    pfr: ratio(agg.pfrCount, agg.handsPlayed),
    aggressionFactor: ratio(agg.aggressiveActions, agg.passiveActions),
    showdownWinRate: ratio(agg.showdownsWon, agg.showdownsSeen),
  };
}
