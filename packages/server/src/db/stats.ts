import { inArray } from 'drizzle-orm';
import type { PlayerHandStat } from '@poker/shared';
import type { StatsService } from '../rooms/game.js';
import { getDb, schema } from './index.js';
import { addFact, addSession, emptyAggregate, type AggregateState } from './stats-aggregate.js';

/** Map a stored aggregate row to the in-memory accumulator shape. */
function rowToAggregate(row: typeof schema.playerStats.$inferSelect): AggregateState {
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
