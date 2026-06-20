import { eq } from 'drizzle-orm';
import type { PlayerHandStat } from '@poker/shared';
import { getDb, schema } from './index.js';
import { emptyAggregate, addFact, type AggregateState } from './stats-aggregate.js';
import { rowToAggregate } from './stats.js';

/** Convert a stored fact row to the PlayerHandStat shape the reducer expects. */
function rowToFact(r: typeof schema.playerHandStats.$inferSelect): PlayerHandStat {
  return {
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
  };
}

/**
 * Rebuild every player's hand-derived aggregates from the fact table.
 * Session columns (total_play_ms, games_played) are read from the existing row
 * and carried over, since they cannot be reconstructed from facts.
 */
export async function recomputeAllPlayerStats(): Promise<{ players: number; facts: number }> {
  const db = getDb();
  const facts = await db.select().from(schema.playerHandStats);

  const byPlayer = new Map<string, AggregateState>();
  for (const row of facts) {
    const current = byPlayer.get(row.playerId) ?? emptyAggregate();
    byPlayer.set(row.playerId, addFact(current, rowToFact(row)));
  }

  for (const [playerId, agg] of byPlayer) {
    const [existing] = await db
      .select()
      .from(schema.playerStats)
      .where(eq(schema.playerStats.playerId, playerId));
    const session = existing ? rowToAggregate(existing) : emptyAggregate();

    const merged: AggregateState = {
      ...agg,
      totalPlayMs: session.totalPlayMs, // session-level: preserved
      gamesPlayed: session.gamesPlayed,
    };

    const values = {
      playerId,
      handsPlayed: merged.handsPlayed,
      handsWon: merged.handsWon,
      handsLost: merged.handsLost,
      chipsBet: merged.chipsBet,
      chipsWon: merged.chipsWon,
      chipsLost: merged.chipsLost,
      netProfit: merged.netProfit,
      biggestPotWon: merged.biggestPotWon,
      showdownsWon: merged.showdownsWon,
      showdownsSeen: merged.showdownsSeen,
      vpipCount: merged.vpipCount,
      pfrCount: merged.pfrCount,
      aggressiveActions: merged.aggressiveActions,
      passiveActions: merged.passiveActions,
      categoryCounts: merged.categoryCounts,
      totalPlayMs: merged.totalPlayMs,
      gamesPlayed: merged.gamesPlayed,
      updatedAt: new Date(),
    };
    await db
      .insert(schema.playerStats)
      .values(values)
      .onConflictDoUpdate({ target: schema.playerStats.playerId, set: values });
  }

  return { players: byPlayer.size, facts: facts.length };
}

// CLI: `npm run stats:recompute`
if (import.meta.url === `file://${process.argv[1]}`) {
  recomputeAllPlayerStats()
    .then((r) => {
      console.log(`[stats] recomputed ${r.players} players from ${r.facts} facts`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[stats] recompute failed:', err);
      process.exit(1);
    });
}
