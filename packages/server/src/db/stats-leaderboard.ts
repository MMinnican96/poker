import type { LeaderboardEntry, LeaderboardMetric } from '@poker/shared';
import type { PlayerStatsRow } from './schema.js';

export const LEADERBOARD_METRICS: LeaderboardMetric[] = [
  'net_profit',
  'chips_won',
  'hands_won',
  'biggest_pot_won',
  'hands_played',
];

const METRIC_COLUMN: Record<LeaderboardMetric, keyof PlayerStatsRow> = {
  net_profit: 'netProfit',
  chips_won: 'chipsWon',
  hands_won: 'handsWon',
  biggest_pot_won: 'biggestPotWon',
  hands_played: 'handsPlayed',
};

export function metricColumn(metric: LeaderboardMetric): keyof PlayerStatsRow {
  return METRIC_COLUMN[metric];
}

/** Attach 1-based ranks to already-sorted rows. */
export function rankRows(
  rows: { playerId: string; displayName: string | null; value: number }[],
  metric: LeaderboardMetric,
): LeaderboardEntry[] {
  return rows.map((row, i) => ({
    playerId: row.playerId,
    displayName: row.displayName,
    metric,
    value: row.value,
    rank: i + 1,
  }));
}
