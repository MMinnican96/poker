import { desc, eq, gte, sql, arrayContains } from 'drizzle-orm';
import type {
  Card,
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
  PlayerStatsSummary,
} from '@poker/shared';
import { LEADERBOARD_METRICS } from '@poker/shared';
import type { Db } from '../db/client.js';
import { handHistory, playerHandStats, players, playerStats, tableSeats } from '../db/schema.js';
import { rowToAggregate } from './recorder.js';
import { emptyAggregate, toPlayerStatsSummary } from './stats-aggregate.js';
import { getPublicPlayers } from './players.js';
import type { HandHistoryRecord } from './hand-facts.js';

/** A hand as one viewer may see it: other players' cards only if shown. */
export interface HandHistoryView {
  tableId: string;
  handNumber: number;
  playedAt: string;
  board: Card[];
  pots: HandHistoryRecord['pots'];
  players: (Omit<HandHistoryRecord['players'][number], 'cards'> & { name: string; cards: [Card, Card] | null })[];
}

export class StatsRepository {
  constructor(private readonly db: Db) {}

  async summary(playerId: string): Promise<PlayerStatsSummary> {
    const [row] = await this.db.select().from(playerStats).where(eq(playerStats.playerId, playerId));
    return toPlayerStatsSummary(playerId, row ? rowToAggregate(row) : emptyAggregate());
  }

  /** Net result of the player's last `n` hands, oldest first. */
  async recentForm(playerId: string, n = 20): Promise<number[]> {
    const rows = await this.db.select({ net: playerHandStats.netResult }).from(playerHandStats)
      .where(eq(playerHandStats.playerId, playerId))
      .orderBy(desc(playerHandStats.createdAt), desc(playerHandStats.handNumber))
      .limit(n);
    return rows.map((r) => r.net).reverse();
  }

  /** Cumulative net profit over the last `n` hands (for the stats chart), oldest first. */
  async profitCurve(playerId: string, n = 200): Promise<{ hand: number; total: number; at: string }[]> {
    const rows = await this.db.select({ net: playerHandStats.netResult, at: playerHandStats.createdAt })
      .from(playerHandStats)
      .where(eq(playerHandStats.playerId, playerId))
      .orderBy(desc(playerHandStats.createdAt), desc(playerHandStats.handNumber))
      .limit(n);
    let total = 0;
    return rows.reverse().map((r, i) => {
      total += r.net;
      return { hand: i + 1, total, at: r.at.toISOString() };
    });
  }

  async leaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod, limit = 25): Promise<LeaderboardEntry[]> {
    const def = LEADERBOARD_METRICS.find((m) => m.id === metric);
    if (!def) throw new Error(`Unknown metric ${metric}`);
    const weekly = period === 'week' && def.weekly;

    let ranked: { id: string; value: number }[];
    if (metric === 'bankroll') {
      // Bankroll includes chips currently sitting at a table.
      const escrow = this.db.select({
        playerId: tableSeats.playerId,
        total: sql<number>`sum(${tableSeats.stack})`.as('total'),
      }).from(tableSeats).where(eq(tableSeats.status, 'open')).groupBy(tableSeats.playerId).as('escrow');
      const rows = await this.db.select({
        id: players.discordUserId,
        value: sql<number>`${players.chipBalance} + coalesce(${escrow.total}, 0)`,
      }).from(players).leftJoin(escrow, eq(escrow.playerId, players.discordUserId))
        .orderBy(desc(sql`${players.chipBalance} + coalesce(${escrow.total}, 0)`)).limit(limit);
      ranked = rows.map((r) => ({ id: r.id, value: Number(r.value) }));
    } else if (metric === 'level') {
      const rows = await this.db.select({ id: players.discordUserId, value: players.xp })
        .from(players).orderBy(desc(players.xp)).limit(limit);
      ranked = rows.map((r) => ({ id: r.id, value: r.value }));
    } else if (!weekly) {
      const column = {
        net_profit: playerStats.netProfit,
        chips_won: playerStats.chipsWon,
        hands_won: playerStats.handsWon,
        biggest_pot_won: playerStats.biggestPotWon,
        hands_played: playerStats.handsPlayed,
      }[metric];
      const rows = await this.db.select({ id: playerStats.playerId, value: column })
        .from(playerStats).where(sql`${playerStats.handsPlayed} > 0`).orderBy(desc(column)).limit(limit);
      ranked = rows.map((r) => ({ id: r.id, value: Number(r.value) }));
    } else {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const expr = {
        net_profit: sql<number>`sum(${playerHandStats.netResult})`,
        chips_won: sql<number>`sum(${playerHandStats.chipsWon})`,
        hands_won: sql<number>`sum(case when ${playerHandStats.result} = 'won' then 1 else 0 end)`,
        biggest_pot_won: sql<number>`max(case when ${playerHandStats.result} = 'won' then ${playerHandStats.chipsWon} else 0 end)`,
        hands_played: sql<number>`count(*)`,
      }[metric];
      const rows = await this.db.select({ id: playerHandStats.playerId, value: expr })
        .from(playerHandStats).where(gte(playerHandStats.createdAt, since))
        .groupBy(playerHandStats.playerId).orderBy(desc(expr)).limit(limit);
      ranked = rows.map((r) => ({ id: r.id, value: Number(r.value) }));
    }

    const people = await getPublicPlayers(this.db, ranked.map((r) => r.id));
    const out: LeaderboardEntry[] = [];
    let rank = 0;
    let prev: number | null = null;
    ranked.forEach((r, i) => {
      if (r.value !== prev) rank = i + 1; // ties share a rank
      prev = r.value;
      const player = people.get(r.id);
      if (player) out.push({ rank, player, value: metric === 'level' ? player.level : r.value });
    });
    return out;
  }

  /** Recent hands the player was dealt into, filtered for their eyes. */
  async history(playerId: string, limit = 20): Promise<HandHistoryView[]> {
    const rows = await this.db.select().from(handHistory)
      .where(arrayContains(handHistory.playerIds, [playerId]))
      .orderBy(desc(handHistory.createdAt), desc(handHistory.handNumber))
      .limit(limit);
    const names = await getPublicPlayers(this.db, rows.flatMap((r) => r.playerIds));
    return rows.map((r) => ({
      tableId: r.tableId,
      handNumber: r.handNumber,
      playedAt: r.createdAt.toISOString(),
      board: r.board as Card[],
      pots: r.pots as HandHistoryRecord['pots'],
      players: (r.players as HandHistoryRecord['players']).map((p) => ({
        ...p,
        name: names.get(p.id)?.name ?? 'Unknown',
        cards: p.id === playerId || p.shown ? p.cards : null,
      })),
    }));
  }
}

