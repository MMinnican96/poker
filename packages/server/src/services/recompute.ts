import '../env.js';
import { pathToFileURL } from 'node:url';
import type { PlayerHandStat } from '@poker/shared';
import { openDatabase, type Db } from '../db/client.js';
import { playerHandStats, playerStats } from '../db/schema.js';
import { addFact, emptyAggregate, type AggregateState } from './stats-aggregate.js';
import { rowToAggregate, writeAggregate } from './recorder.js';

/**
 * Rebuild every player's hand-derived aggregates from the fact table. Session
 * columns (play time, sessions) cannot be rebuilt from facts and are preserved.
 */
export async function recomputeAllPlayerStats(db: Db): Promise<{ players: number; facts: number }> {
  const facts = await db.select().from(playerHandStats);
  const existing = new Map((await db.select().from(playerStats)).map((r) => [r.playerId, rowToAggregate(r)]));
  const byPlayer = new Map<string, AggregateState>();
  for (const row of facts) {
    const fact: PlayerHandStat = {
      ...row,
      result: row.result as PlayerHandStat['result'],
      handCategory: row.handCategory as PlayerHandStat['handCategory'],
      finalStreet: row.finalStreet as PlayerHandStat['finalStreet'],
      createdAt: row.createdAt.toISOString(),
    };
    byPlayer.set(row.playerId, addFact(byPlayer.get(row.playerId) ?? emptyAggregate(), fact));
  }
  await db.transaction(async (tx) => {
    for (const [playerId, agg] of byPlayer) {
      const session = existing.get(playerId) ?? emptyAggregate();
      await writeAggregate(tx, playerId, { ...agg, totalPlayMs: session.totalPlayMs, sessionsPlayed: session.sessionsPlayed });
    }
  });
  return { players: byPlayer.size, facts: facts.length };
}

// CLI: `npm run stats:recompute`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = await openDatabase();
  recomputeAllPlayerStats(handle.db)
    .then((r) => console.log(`[stats] recomputed ${r.players} players from ${r.facts} facts`))
    .catch((err) => { console.error('[stats] recompute failed:', err); process.exitCode = 1; })
    .finally(() => handle.close());
}
