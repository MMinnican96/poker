import { eq, inArray, sql } from 'drizzle-orm';
import {
  METRICS,
  activeChallenges,
  metricValue,
  periodKeyFor,
  xpForHand,
  type AchievementUnlock,
  type ChallengeDef,
  type ChallengePeriod,
  type HandFact,
} from '@poker/shared';
import type { Db, DbOrTx } from '../db/client.js';
import { handHistory, playerChallenges, playerHandStats, players, playerStats } from '../db/schema.js';
import { addFact, addSession, emptyAggregate, type AggregateState } from './stats-aggregate.js';
import { applyHandFacts } from './achievements.js';
import { factColumns, type HandHistoryRecord } from './hand-facts.js';
import { applyLevelUps, type LevelUp } from './xp.js';

export { grantXp, type LevelUp } from './xp.js';
export interface ChallengeDone { playerId: string; challenge: ChallengeDef; periodKey: string }

export interface RecordOutcome {
  levelUps: LevelUp[];
  completed: ChallengeDone[];
  /** Achievement tiers reached (and already paid) by this hand. */
  unlocks: AchievementUnlock[];
  /** XP gained per player from this hand. */
  xp: Record<string, number>;
}

/**
 * Persists a finished hand: facts, history, aggregates, XP (with level-up chip
 * rewards), daily/weekly challenge progress and achievements — all in one
 * transaction. Facts are unique per
 * (table, player, hand), and only newly inserted facts feed the rest, so a
 * replay can never double-count.
 */
export class HandRecorder {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async recordHand(facts: HandFact[], history: HandHistoryRecord): Promise<RecordOutcome> {
    const outcome: RecordOutcome = { levelUps: [], completed: [], unlocks: [], xp: {} };
    if (facts.length === 0) return outcome;
    const now = this.clock();

    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(playerHandStats)
        .values(facts.map(factColumns))
        .onConflictDoNothing()
        .returning({ playerId: playerHandStats.playerId });
      const freshIds = new Set(inserted.map((r) => r.playerId));
      const fresh = facts.filter((f) => freshIds.has(f.playerId));
      if (fresh.length === 0) return;

      await tx.insert(handHistory).values({
        tableId: history.tableId,
        handNumber: history.handNumber,
        board: history.board,
        pots: history.pots,
        players: history.players,
        playerIds: history.players.map((p) => p.id),
      }).onConflictDoNothing();

      await this.updateAggregates(tx, fresh);
      await this.updateXp(tx, fresh, outcome);
      await this.updateChallenges(tx, fresh, now, outcome);
      const settled = await applyHandFacts(tx, fresh);
      outcome.unlocks.push(...settled.unlocks);
      outcome.levelUps.push(...settled.levelUps);
    });
    return outcome;
  }

  /** Add one table session's play time for a player. */
  async recordSession(playerId: string, playMs: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const agg = await loadAggregate(tx, playerId);
      await writeAggregate(tx, playerId, addSession(agg, Math.max(0, Math.round(playMs))));
    });
  }

  private async updateAggregates(tx: DbOrTx, fresh: HandFact[]): Promise<void> {
    const ids = [...new Set(fresh.map((f) => f.playerId))].sort();
    // Make sure every row exists before locking: a missing row can't be locked,
    // so two tables finishing a new player's first hands at once would race.
    await ensureStatsRows(tx, ids);
    const rows = await tx.select().from(playerStats).where(inArray(playerStats.playerId, ids)).for('update');
    const byId = new Map(rows.map((r) => [r.playerId, rowToAggregate(r)]));
    for (const f of fresh) byId.set(f.playerId, addFact(byId.get(f.playerId) ?? emptyAggregate(), f));
    for (const [id, agg] of byId) await writeAggregate(tx, id, agg);
  }

  private async updateXp(tx: DbOrTx, fresh: HandFact[], outcome: RecordOutcome): Promise<void> {
    for (const f of fresh) {
      const gain = xpForHand(f);
      const [row] = await tx.update(players)
        .set({ xp: sql`${players.xp} + ${gain}` })
        .where(eq(players.discordUserId, f.playerId))
        .returning({ xp: players.xp });
      if (!row) continue;
      outcome.xp[f.playerId] = (outcome.xp[f.playerId] ?? 0) + gain;
      outcome.levelUps.push(...await applyLevelUps(tx, f.playerId, row.xp - gain, row.xp));
    }
  }

  /** Daily/weekly progress from the metric registry. Streak challenges keep `current` in the period row. */
  private async updateChallenges(tx: DbOrTx, fresh: HandFact[], now: Date, outcome: RecordOutcome) {
    const periods: ChallengePeriod[] = ['daily', 'weekly'];
    const target = [playerChallenges.playerId, playerChallenges.periodKey, playerChallenges.challengeId];
    for (const period of periods) {
      const periodKey = periodKeyFor(period, now);
      const defs = activeChallenges(period, periodKey);
      for (const f of fresh) {
        for (const def of defs) {
          const value = metricValue(def.metric, f);
          const key = { playerId: f.playerId, periodKey, challengeId: def.id };
          let row: typeof playerChallenges.$inferSelect;
          if (METRICS[def.metric].mode === 'streak') {
            // A hit extends this period's streak, a miss resets it; progress keeps the best.
            const hit = value > 0 ? 1 : 0;
            const next = sql`case when ${hit}::int > 0 then ${playerChallenges.current} + 1 else 0 end`;
            [row] = await tx.insert(playerChallenges)
              .values({ ...key, progress: hit, current: hit })
              .onConflictDoUpdate({ target, set: { current: next, progress: sql`greatest(${playerChallenges.progress}, ${next})` } })
              .returning();
          } else {
            if (value === 0) continue;
            [row] = await tx.insert(playerChallenges)
              .values({ ...key, progress: value })
              .onConflictDoUpdate({ target, set: { progress: sql`${playerChallenges.progress} + ${value}` } })
              .returning();
          }
          if (!row.completedAt && row.progress >= def.goal) {
            await tx.update(playerChallenges).set({ completedAt: now }).where(eq(playerChallenges.id, row.id));
            outcome.completed.push({ playerId: f.playerId, challenge: def, periodKey });
          }
        }
      }
    }
  }
}

/** Insert empty aggregate rows for players who have none yet (no-op otherwise). */
async function ensureStatsRows(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.insert(playerStats).values(ids.map((playerId) => ({ playerId }))).onConflictDoNothing({ target: playerStats.playerId });
}

async function loadAggregate(tx: DbOrTx, playerId: string): Promise<AggregateState> {
  await ensureStatsRows(tx, [playerId]);
  const [row] = await tx.select().from(playerStats).where(eq(playerStats.playerId, playerId)).for('update');
  return row ? rowToAggregate(row) : emptyAggregate();
}

export function rowToAggregate(row: typeof playerStats.$inferSelect): AggregateState {
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
    flopsSeen: row.flopsSeen,
    vpipCount: row.vpipCount,
    pfrCount: row.pfrCount,
    aggressiveActions: row.aggressiveActions,
    passiveActions: row.passiveActions,
    categoryCounts: (row.categoryCounts as Record<string, number>) ?? {},
    totalPlayMs: row.totalPlayMs,
    sessionsPlayed: row.gamesPlayed,
  };
}

export async function writeAggregate(tx: DbOrTx, playerId: string, agg: AggregateState): Promise<void> {
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
    flopsSeen: agg.flopsSeen,
    vpipCount: agg.vpipCount,
    pfrCount: agg.pfrCount,
    aggressiveActions: agg.aggressiveActions,
    passiveActions: agg.passiveActions,
    categoryCounts: agg.categoryCounts,
    totalPlayMs: agg.totalPlayMs,
    gamesPlayed: agg.sessionsPlayed,
    updatedAt: new Date(),
  };
  await tx.insert(playerStats).values(values).onConflictDoUpdate({ target: playerStats.playerId, set: values });
}

