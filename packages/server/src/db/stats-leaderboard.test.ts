import { describe, it, expect } from 'vitest';
import { LEADERBOARD_METRICS, metricColumn, rankRows } from './stats-leaderboard.js';

describe('leaderboard mapping', () => {
  it('maps every supported metric to an aggregate column', () => {
    expect(metricColumn('net_profit')).toBe('netProfit');
    expect(metricColumn('chips_won')).toBe('chipsWon');
    expect(metricColumn('hands_won')).toBe('handsWon');
    expect(metricColumn('biggest_pot_won')).toBe('biggestPotWon');
    expect(metricColumn('hands_played')).toBe('handsPlayed');
  });

  it('exposes the full supported metric list', () => {
    expect(LEADERBOARD_METRICS).toContain('net_profit');
    expect(LEADERBOARD_METRICS).toHaveLength(5);
  });

  it('assigns 1-based ranks preserving input order', () => {
    const ranked = rankRows(
      [
        { playerId: 'a', displayName: 'A', value: 500 },
        { playerId: 'b', displayName: 'B', value: 300 },
      ],
      'net_profit',
    );
    expect(ranked).toEqual([
      { playerId: 'a', displayName: 'A', metric: 'net_profit', value: 500, rank: 1 },
      { playerId: 'b', displayName: 'B', metric: 'net_profit', value: 300, rank: 2 },
    ]);
  });
});
