import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  PlayerHandStat,
  PlayerStatsSummary,
} from '@poker/shared';
import type { StatsService } from '../rooms/game.js';
import { getDb, schema } from './index.js';
import { addFact, addSession, emptyAggregate, toPlayerStatsSummary, type AggregateState } from './stats-aggregate.js';
import { metricColumn, rankRows } from './stats-leaderboard.js';

/** Map a stored aggregate row to the in-memory accumulator shape. */
export function rowToAggregate(row: typeof schema.playerStats.$inferSelect): AggregateState {
  return {
    handsPlayed: row.handsPlayed,
    handsWon: row.handsWon,
    handsLost: row.handsLost,
    chipsBet: row.chipsBet,
    chipsWon: row.chipsWon,
    chipsLost: row.chipsLost,
    netProfit: row.netProfit,
    biggestPotWon: row.biggestPotWon,
    showdownsWon: row.showdownsWon,
    showdownsSeen: row.showdownsSeen,
    vpipCount: row.vpipCount,
    pfrCount: row.pfrCount,
    aggressiveActions: row.aggressiveActions,
    passiveActions: row.passiveActions,
    categoryCounts: (row.categoryCounts as Record<string, number>) ?? {},
    totalPlayMs: row.totalPlayMs,
    gamesPlayed: row.gamesPlayed,
  };
}

/** Persist the accumulator back to player_stats (upsert), keeping updated_at fresh. */
async function writeAggregate(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  playerId: string,
  agg: AggregateState,
): Promise<void> {
  const values = {
    playerId,
    handsPlayed: agg.handsPlayed,
    handsWon: agg.handsWon,
    handsLost: agg.handsLost,
    chipsBet: agg.chipsBet,
    chipsWon: agg.chipsWon,
    chipsLost: agg.chipsLost,
    netProfit: agg.netProfit,
    biggestPotWon: agg.biggestPotWon,
    showdownsWon: agg.showdownsWon,
    showdownsSeen: agg.showdownsSeen,
    vpipCount: agg.vpipCount,
    pfrCount: agg.pfrCount,
    aggressiveActions: agg.aggressiveActions,
    passiveActions: agg.passiveActions,
    categoryCounts: agg.categoryCounts,
    totalPlayMs: agg.totalPlayMs,
    gamesPlayed: agg.gamesPlayed,
    updatedAt: new Date(),
  };
  await tx
    .insert(schema.playerStats)
    .values(values)
    .onConflictDoUpdate({ target: schema.playerStats.playerId, set: values });
}

/**
 * DB-backed stats writer. Each call runs in one transaction so facts and
 * aggregates never diverge. Facts are inserted idempotently (unique on
 * game_id+player_id+hand_number); only newly-inserted facts update aggregates,
 * so a replayed hand cannot double-count.
 */
export const dbStatsService: StatsService = {
  async recordHand(facts: PlayerHandStat[]): Promise<void> {
    if (facts.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.playerHandStats)
        .values(facts.map((f) => ({
          gameId: f.gameId,
          playerId: f.playerId,
          handNumber: f.handNumber,
          seatIndex: f.seatIndex,
          position: f.position,
          chipsContributed: f.chipsContributed,
          chipsWon: f.chipsWon,
          netResult: f.netResult,
          result: f.result,
          handCategory: f.handCategory,
          potTotal: f.potTotal,
          wentToShowdown: f.wentToShowdown,
          vpip: f.vpip,
          pfr: f.pfr,
          aggressiveActions: f.aggressiveActions,
          passiveActions: f.passiveActions,
          wasAllIn: f.wasAllIn,
          finalStreet: f.finalStreet,
          durationMs: f.durationMs,
        })))
        .onConflictDoNothing({
          target: [
            schema.playerHandStats.gameId,
            schema.playerHandStats.playerId,
            schema.playerHandStats.handNumber,
          ],
        })
        .returning({
          gameId: schema.playerHandStats.gameId,
          playerId: schema.playerHandStats.playerId,
          handNumber: schema.playerHandStats.handNumber,
        });

      if (inserted.length === 0) return; // entire batch was a replay

      const insertedKeys = new Set(inserted.map((r) => `${r.gameId}:${r.playerId}:${r.handNumber}`));
      const freshFacts = facts.filter((f) => insertedKeys.has(`${f.gameId}:${f.playerId}:${f.handNumber}`));

      const playerIds = [...new Set(freshFacts.map((f) => f.playerId))];
      if (playerIds.length === 0) return; // safety: never hit given the guards above, but keeps inArray well-formed
      const existing = await tx
        .select()
        .from(schema.playerStats)
        .where(inArray(schema.playerStats.playerId, playerIds));
      const byId = new Map(existing.map((r) => [r.playerId, rowToAggregate(r)]));

      for (const f of freshFacts) {
        const current = byId.get(f.playerId) ?? emptyAggregate();
        byId.set(f.playerId, addFact(current, f));
      }
      for (const [playerId, agg] of byId) {
        await writeAggregate(tx, playerId, agg);
      }
    });
  },

  async recordSession(input): Promise<void> {
    if (input.players.length === 0) return;
    const db = getDb();
    await db.transaction(async (tx) => {
      const playerIds = input.players.map((p) => p.playerId);
      if (playerIds.length === 0) return; // safety: never hit given the guards above, but keeps inArray well-formed
      const existing = await tx
        .select()
        .from(schema.playerStats)
        .where(inArray(schema.playerStats.playerId, playerIds));
      const byId = new Map(existing.map((r) => [r.playerId, rowToAggregate(r)]));

      for (const p of input.players) {
        const current = byId.get(p.playerId) ?? emptyAggregate();
        byId.set(p.playerId, addSession(current, p.playMs));
      }
      for (const [playerId, agg] of byId) {
        await writeAggregate(tx, playerId, agg);
      }
    });
  },
};

export interface StatsRepository {
  getPlayerStats(playerId: string): Promise<PlayerStatsSummary | null>;
  getLeaderboard(opts: {
    metric: LeaderboardMetric;
    limit: number;
    since?: Date;
  }): Promise<LeaderboardEntry[]>;
  getPlayerHandHistory(
    playerId: string,
    opts: { limit: number; since?: Date },
  ): Promise<PlayerHandStat[]>;
}

export const dbStatsRepository: StatsRepository = {
  async getPlayerStats(playerId) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.playerStats)
      .where(eq(schema.playerStats.playerId, playerId));
    if (!row) return null;
    return toPlayerStatsSummary(playerId, rowToAggregate(row));
  },

  async getLeaderboard({ metric, limit, since }) {
    const db = getDb();

    // All-time: rank straight off the aggregate columns.
    if (!since) {
      const column = schema.playerStats[metricColumn(metric)];
      const rows = await db
        .select({
          playerId: schema.playerStats.playerId,
          displayName: schema.players.displayName,
          value: column,
        })
        .from(schema.playerStats)
        .leftJoin(schema.players, eq(schema.players.discordUserId, schema.playerStats.playerId))
        .orderBy(desc(column))
        .limit(limit);
      return rankRows(
        rows.map((r) => ({ playerId: r.playerId, displayName: r.displayName, value: Number(r.value) })),
        metric,
      );
    }

    // Windowed: aggregate the fact table since `since`, then rank in JS.
    const facts = await db
      .select()
      .from(schema.playerHandStats)
      .where(gte(schema.playerHandStats.createdAt, since));
    const byPlayer = new Map<string, number>();
    for (const f of facts) {
      const prev = byPlayer.get(f.playerId) ?? 0;
      byPlayer.set(f.playerId, prev + windowedMetricValue(metric, f));
    }
    const names = await db
      .select({ id: schema.players.discordUserId, displayName: schema.players.displayName })
      .from(schema.players);
    const nameById = new Map(names.map((n) => [n.id, n.displayName]));
    const sorted = [...byPlayer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([playerId, value]) => ({ playerId, displayName: nameById.get(playerId) ?? null, value }));
    return rankRows(sorted, metric);
  },

  async getPlayerHandHistory(playerId, { limit, since }) {
    const db = getDb();
    const where = since
      ? and(eq(schema.playerHandStats.playerId, playerId), gte(schema.playerHandStats.createdAt, since))
      : eq(schema.playerHandStats.playerId, playerId);
    const rows = await db
      .select()
      .from(schema.playerHandStats)
      .where(where)
      .orderBy(desc(schema.playerHandStats.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      gameId: r.gameId,
      playerId: r.playerId,
      handNumber: r.handNumber,
      seatIndex: r.seatIndex,
      position: r.position,
      chipsContributed: r.chipsContributed,
      chipsWon: r.chipsWon,
      netResult: r.netResult,
      result: r.result as PlayerHandStat['result'],
      handCategory: r.handCategory as PlayerHandStat['handCategory'],
      potTotal: r.potTotal,
      wentToShowdown: r.wentToShowdown,
      vpip: r.vpip,
      pfr: r.pfr,
      aggressiveActions: r.aggressiveActions,
      passiveActions: r.passiveActions,
      wasAllIn: r.wasAllIn,
      finalStreet: r.finalStreet as PlayerHandStat['finalStreet'],
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
  },
};

/** Contribution of one fact to a windowed leaderboard metric. */
function windowedMetricValue(metric: LeaderboardMetric, f: typeof schema.playerHandStats.$inferSelect): number {
  switch (metric) {
    case 'net_profit': return f.netResult;
    case 'chips_won': return f.chipsWon;
    case 'hands_won': return f.result === 'won' ? 1 : 0;
    case 'biggest_pot_won': return f.result === 'won' ? f.potTotal : 0; // summed; refine later if needed
    case 'hands_played': return 1;
  }
}

/** Used in dev/mock mode (no DATABASE_URL): everything is empty. */
export const noopStatsRepository: StatsRepository = {
  async getPlayerStats() { return null; },
  async getLeaderboard() { return []; },
  async getPlayerHandHistory() { return []; },
};
