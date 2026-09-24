import { eq, gte, sql, arrayContains, desc, type AnyColumn } from 'drizzle-orm';
import type {
  Card,
  LeaderboardEntry,
  LeaderboardResponse,
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

/** Card back for hands stored before card backs were recorded. */
export const FALLBACK_CARD_BACK = 'back-classic';

/** A hand as one viewer may see it: other players' cards only if shown. */
export interface HandHistoryView {
  tableId: string;
  handNumber: number;
  playedAt: string;
  board: Card[];
  pots: HandHistoryRecord['pots'];
  players: (Omit<HandHistoryRecord['players'][number], 'cards' | 'cardBack'> & {
    name: string;
    cards: [Card, Card] | null;
    /** The card back they played with, for drawing face-down cards. */
    cardBack: string;
  })[];
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

  /**
   * The top `limit` players for a metric, plus `meId`'s own entry wherever they
   * rank. Ranks come from `rank()` over the whole board, so ties share a rank
   * (1, 1, 3) both in the list and for you.
   */
  async leaderboard(metric: LeaderboardMetric, period: LeaderboardPeriod, limit = 25, meId?: string): Promise<LeaderboardResponse> {
    const def = LEADERBOARD_METRICS.find((m) => m.id === metric);
    if (!def) throw new Error(`Unknown metric ${metric}`);
    const board = this.board(metric, period === 'week' && def.weekly);
    const ranked = this.db.select({
      id: board.id,
      value: board.value,
      rank: sql<number>`rank() over (order by ${board.value} desc)`.as('rank'),
    }).from(board).as('ranked');

    const [top, mine] = await Promise.all([
      this.db.select().from(ranked).orderBy(ranked.rank, ranked.id).limit(limit),
      meId ? this.db.select().from(ranked).where(eq(ranked.id, meId)) : Promise.resolve([]),
    ]);
    const people = await getPublicPlayers(this.db, [...top, ...mine].map((r) => r.id));
    const entry = (r: { id: string; value: number; rank: number }): LeaderboardEntry | null => {
      const player = people.get(r.id);
      if (!player) return null;
      return { rank: Number(r.rank), player, value: metric === 'level' ? player.level : Number(r.value) };
    };
    return {
      entries: top.flatMap((r) => entry(r) ?? []),
      me: mine[0] ? entry(mine[0]) : null,
    };
  }

  /** Every ranked player's `(id, value)` for a metric, as a subquery. */
  private board(metric: LeaderboardMetric, weekly: boolean) {
    const id = (col: AnyColumn) => sql<string>`${col}`.as('id');
    if (metric === 'bankroll') {
      // Bankroll includes chips currently sitting at a table.
      const escrow = this.db.select({
        playerId: tableSeats.playerId,
        total: sql<number>`sum(${tableSeats.stack})`.as('total'),
      }).from(tableSeats).where(eq(tableSeats.status, 'open')).groupBy(tableSeats.playerId).as('escrow');
      return this.db.select({
        id: id(players.discordUserId),
        value: sql<number>`${players.chipBalance} + coalesce(${escrow.total}, 0)`.as('value'),
      }).from(players).leftJoin(escrow, eq(escrow.playerId, players.discordUserId)).as('board');
    }
    if (metric === 'level') {
      // Ranked by XP, so players on the same level are still ordered by progress.
      return this.db.select({ id: id(players.discordUserId), value: sql<number>`${players.xp}`.as('value') })
        .from(players).as('board');
    }
    if (!weekly) {
      const column = {
        net_profit: playerStats.netProfit,
        chips_won: playerStats.chipsWon,
        hands_won: playerStats.handsWon,
        biggest_pot_won: playerStats.biggestPotWon,
        hands_played: playerStats.handsPlayed,
      }[metric];
      return this.db.select({ id: id(playerStats.playerId), value: sql<number>`${column}`.as('value') })
        .from(playerStats).where(sql`${playerStats.handsPlayed} > 0`).as('board');
    }
    const since = new Date(Date.now() - 7 * 86_400_000);
    const expr = {
      net_profit: sql<number>`sum(${playerHandStats.netResult})`,
      chips_won: sql<number>`sum(${playerHandStats.chipsWon})`,
      hands_won: sql<number>`sum(case when ${playerHandStats.result} = 'won' then 1 else 0 end)`,
      biggest_pot_won: sql<number>`max(case when ${playerHandStats.result} = 'won' then ${playerHandStats.chipsWon} else 0 end)`,
      hands_played: sql<number>`count(*)`,
    }[metric];
    return this.db.select({ id: id(playerHandStats.playerId), value: expr.as('value') })
      .from(playerHandStats).where(gte(playerHandStats.createdAt, since))
      .groupBy(playerHandStats.playerId).as('board');
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
        cardBack: p.cardBack ?? FALLBACK_CARD_BACK,
      })),
    }));
  }
}

