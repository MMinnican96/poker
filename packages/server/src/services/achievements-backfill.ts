import '../env.js';
import { pathToFileURL } from 'node:url';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  achievementsForMetric,
  type Card,
  type EventMetricId,
  type HandFact,
  type PlayerHandStat,
} from '@poker/shared';
import { openDatabase, type Db } from '../db/client.js';
import { appMeta, handHistory, playerChallenges, playerHandStats, players, type PlayerHandStatRow } from '../db/schema.js';
import { lockBalance } from './bank.js';
import { countOwnedItems, foldFacts, settle, writeFolded, type FoldedProgress } from './achievements.js';
import type { HandHistoryRecord } from './hand-facts.js';

/** app_meta key marking that the one-time boot backfill has run. */
export const ACHIEVEMENTS_BACKFILL_KEY = 'achievements-backfill-v1';

/** A stored fact (plus its hand history, when there is one) as the metrics see it. */
export function rowToFact(
  row: PlayerHandStatRow,
  history: { board: unknown; players: unknown } | null,
): HandFact {
  const seat = history ? (history.players as HandHistoryRecord['players']).find((p) => p.id === row.playerId) : undefined;
  const cards = seat?.cards;
  const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
  return {
    tableId: row.tableId,
    playerId: row.playerId,
    handNumber: row.handNumber,
    seat: row.seat,
    position: row.position,
    bigBlind: row.bigBlind,
    chipsContributed: row.chipsContributed,
    chipsWon: row.chipsWon,
    netResult: row.netResult,
    result: row.result as PlayerHandStat['result'],
    handCategory: row.handCategory as PlayerHandStat['handCategory'],
    potTotal: row.potTotal,
    wentToShowdown: row.wentToShowdown,
    vpip: row.vpip,
    pfr: row.pfr,
    aggressiveActions: row.aggressiveActions,
    passiveActions: row.passiveActions,
    wasAllIn: row.wasAllIn,
    finalStreet: row.finalStreet as PlayerHandStat['finalStreet'],
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    holeCards: cards && cards.length === 2 ? [cards[0], cards[1]] : null,
    board: history ? (history.board as Card[]) : [],
    playersDealt: opt(row.playersDealt),
    startingStack: opt(row.startingStack),
    knockouts: opt(row.knockouts),
    checkRaise: opt(row.checkRaise),
    threeBet: opt(row.threeBet),
    allInPreflop: opt(row.allInPreflop),
    behindOnTurn: opt(row.behindOnTurn),
    splitPot: opt(row.splitPot),
    showdownOpponents: opt(row.showdownOpponents),
  };
}

/** Facts read per query while folding one player's history. */
const FACT_BATCH = 500;

/**
 * Rebuild achievement progress from history and pay any tiers it reaches.
 *
 * One player at a time, hand metrics fold that player's stored facts in
 * (created_at, hand_number) order, read in bounded batches and joined with
 * hand history for hole cards and the board, so memory stays flat however long
 * the history. Event metrics come from current state: daily streak, claimed
 * challenges and items owned (level is read from XP when tiers settle).
 * Progress only ever goes up (GREATEST with what is stored), an existing row
 * keeps its streak in progress, and tiers are paid exactly as live unlocks
 * are, so running it again pays nothing twice. Sends no notices.
 *
 * Hands recorded while it runs (by this or another process) may be missed by
 * metrics the fold computes, if they land after that player's facts were read;
 * live recording counts them itself only once this code is serving.
 */
export async function recomputeAchievements(
  db: Db,
  opts: { batchSize?: number } = {},
): Promise<{ players: number; facts: number; unlocks: number }> {
  const batchSize = Math.max(1, opts.batchSize ?? FACT_BATCH);
  const claimed = new Map((await db.select({ id: playerChallenges.playerId, n: sql<number>`count(*)::int` })
    .from(playerChallenges).where(isNotNull(playerChallenges.claimedAt)).groupBy(playerChallenges.playerId))
    .map((r) => [r.id, Number(r.n)]));
  const everyone = await db.select({ id: players.discordUserId, dailyStreak: players.dailyStreak }).from(players)
    .orderBy(asc(players.discordUserId));

  let facts = 0;
  let unlocks = 0;
  for (const p of everyone) {
    const progress = new Map<string, FoldedProgress>();
    facts += await foldPlayerFacts(db, p.id, progress, batchSize);
    await db.transaction(async (tx) => {
      // Player row first, like every other chip movement.
      if ((await lockBalance(tx, p.id)) === null) return;
      const events: [EventMetricId, number][] = [
        ['daily-streak', p.dailyStreak],
        ['challenges-claimed', claimed.get(p.id) ?? 0],
        ['items-owned', await countOwnedItems(tx, p.id)],
      ];
      for (const [metric, value] of events) {
        for (const def of achievementsForMetric(metric)) progress.set(def.id, { progress: value, current: 0 });
      }
      await writeFolded(tx, p.id, progress);
      unlocks += (await settle(tx, p.id)).unlocks.length;
    });
  }
  return { players: everyone.length, facts, unlocks };
}

/**
 * Fold one player's facts, oldest first, a batch at a time. Pages by a keyset
 * of (created_at, hand_number, id); the timestamp cursor round-trips as text
 * so microseconds survive. Returns how many facts it read.
 */
async function foldPlayerFacts(db: Db, playerId: string, into: Map<string, FoldedProgress>, batchSize: number): Promise<number> {
  const f = playerHandStats;
  let after: { at: string; handNumber: number; id: string } | null = null;
  let count = 0;
  for (;;) {
    const rows = await db.select({ fact: f, at: sql<string>`${f.createdAt}::text`, board: handHistory.board, seats: handHistory.players })
      .from(f)
      .leftJoin(handHistory, and(eq(handHistory.tableId, f.tableId), eq(handHistory.handNumber, f.handNumber)))
      .where(and(
        eq(f.playerId, playerId),
        after ? sql`(${f.createdAt}, ${f.handNumber}, ${f.id}) > (${after.at}::timestamptz, ${after.handNumber}, ${after.id}::uuid)` : undefined,
      ))
      .orderBy(asc(f.createdAt), asc(f.handNumber), asc(f.id))
      .limit(batchSize);
    for (const r of rows) foldFacts([rowToFact(r.fact, r.board === null ? null : { board: r.board, players: r.seats })], into);
    count += rows.length;
    if (rows.length < batchSize) return count;
    const last: { at: string; fact: PlayerHandStatRow } = rows[rows.length - 1];
    after = { at: last.at, handNumber: last.fact.handNumber, id: last.fact.id };
  }
}

/**
 * The one-time boot backfill: runs `recomputeAchievements` unless app_meta
 * says it already has, and marks it done only on success. A failure is
 * logged, not thrown, so the server still starts (the next boot retries).
 */
export async function backfillAchievementsOnce(
  db: Db,
  log: (message: string, err?: unknown) => void = (m, e) => (e ? console.error(m, e) : console.log(m)),
): Promise<'ran' | 'skipped' | 'failed'> {
  try {
    const [done] = await db.select().from(appMeta).where(eq(appMeta.key, ACHIEVEMENTS_BACKFILL_KEY));
    if (done) return 'skipped';
    const r = await recomputeAchievements(db);
    await db.insert(appMeta).values({ key: ACHIEVEMENTS_BACKFILL_KEY, value: new Date().toISOString() })
      .onConflictDoNothing({ target: appMeta.key });
    log(`[achievements] backfilled ${r.players} players from ${r.facts} facts (${r.unlocks} tiers unlocked)`);
    return 'ran';
  } catch (err) {
    log('[achievements] backfill failed; it will run again at the next boot', err);
    return 'failed';
  }
}

// CLI: `npm run achievements:recompute -w @poker/server`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL && !process.env.PGLITE_DATA_DIR) {
    console.error('[achievements] set DATABASE_URL (or PGLITE_DATA_DIR) — without one there is nothing to recompute');
    process.exit(1);
  }
  const handle = await openDatabase();
  recomputeAchievements(handle.db)
    .then(async (r) => {
      await handle.db.insert(appMeta).values({ key: ACHIEVEMENTS_BACKFILL_KEY, value: new Date().toISOString() })
        .onConflictDoNothing({ target: appMeta.key });
      console.log(`[achievements] recomputed ${r.players} players from ${r.facts} facts (${r.unlocks} tiers unlocked)`);
    })
    .catch((err) => { console.error('[achievements] recompute failed:', err); process.exitCode = 1; })
    .finally(() => handle.close());
}
