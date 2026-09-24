import { eq, inArray, sql } from 'drizzle-orm';
import {
  activeChallenges,
  challengeIncrement,
  levelFromXp,
  levelUpReward,
  periodKeyFor,
  xpForHand,
  type ChallengeDef,
  type ChallengePeriod,
  type PlayerHandStat,
} from '@poker/shared';
import type { Db, DbOrTx } from '../db/client.js';
import { handHistory, playerChallenges, playerHandStats, players, playerStats } from '../db/schema.js';
import { addFact, addSession, emptyAggregate, type AggregateState } from './stats-aggregate.js';
import { creditIn } from './bank.js';
import type { HandHistoryRecord } from './hand-facts.js';

export interface LevelUp { playerId: string; level: number; reward: number }
export interface ChallengeDone { playerId: string; challenge: ChallengeDef; periodKey: string }

export interface RecordOutcome {
  levelUps: LevelUp[];
  completed: ChallengeDone[];
  /** XP gained per player from this hand. */
  xp: Record<string, number>;
}

/**
 * Persists a finished hand: facts, history, aggregates, XP (with level-up chip
 * rewards) and challenge progress — all in one transaction. Facts are unique per
 * (table, player, hand), and only newly inserted facts feed the rest, so a
 * replay can never double-count.
 */
export class HandRecorder {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async recordHand(facts: PlayerHandStat[], history: HandHistoryRecord): Promise<RecordOutcome> {
    const outcome: RecordOutcome = { levelUps: [], completed: [], xp: {} };
    if (facts.length === 0) return outcome;
    const now = this.clock();

    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(playerHandStats)
        .values(facts.map((f) => ({
          tableId: f.tableId, playerId: f.playerId, handNumber: f.handNumber, seat: f.seat,
          position: f.position, bigBlind: f.bigBlind, chipsContributed: f.chipsContributed,
          chipsWon: f.chipsWon, netResult: f.netResult, result: f.result, handCategory: f.handCategory,
          potTotal: f.potTotal, wentToShowdown: f.wentToShowdown, vpip: f.vpip, pfr: f.pfr,
          aggressiveActions: f.aggressiveActions, passiveActions: f.passiveActions,
          wasAllIn: f.wasAllIn, finalStreet: f.finalStreet, durationMs: f.durationMs,
        })))
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

  private async updateAggregates(tx: DbOrTx, fresh: PlayerHandStat[]): Promise<void> {
    const ids = [...new Set(fresh.map((f) => f.playerId))].sort();
    // Make sure every row exists before locking: a missing row can't be locked,
    // so two tables finishing a new player's first hands at once would race.
    await ensureStatsRows(tx, ids);
    const rows = await tx.select().from(playerStats).where(inArray(playerStats.playerId, ids)).for('update');
    const byId = new Map(rows.map((r) => [r.playerId, rowToAggregate(r)]));
    for (const f of fresh) byId.set(f.playerId, addFact(byId.get(f.playerId) ?? emptyAggregate(), f));
    for (const [id, agg] of byId) await writeAggregate(tx, id, agg);
  }

  private async updateXp(tx: DbOrTx, fresh: PlayerHandStat[], outcome: RecordOutcome): Promise<void> {
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

  private async updateChallenges(tx: DbOrTx, fresh: PlayerHandStat[], now: Date, outcome: RecordOutcome) {
    const periods: ChallengePeriod[] = ['daily', 'weekly'];
    for (const period of periods) {
      const periodKey = periodKeyFor(period, now);
      const defs = activeChallenges(period, periodKey);
      for (const f of fresh) {
        for (const def of defs) {
          const inc = challengeIncrement(def.metric, f);
          if (inc === 0) continue;
          const [row] = await tx.insert(playerChallenges)
            .values({ playerId: f.playerId, periodKey, challengeId: def.id, progress: inc })
            .onConflictDoUpdate({
              target: [playerChallenges.playerId, playerChallenges.periodKey, playerChallenges.challengeId],
              set: { progress: sql`${playerChallenges.progress} + ${inc}` },
            })
            .returning();
          if (!row.completedAt && row.progress >= def.goal) {
            await tx.update(playerChallenges).set({ completedAt: now }).where(eq(playerChallenges.id, row.id));
            outcome.completed.push({ playerId: f.playerId, challenge: def, periodKey });
          }
        }
      }
    }
  }
}

/** Credit a chip reward for every level crossed between two XP totals. */
async function applyLevelUps(tx: DbOrTx, playerId: string, fromXp: number, toXp: number): Promise<LevelUp[]> {
  const out: LevelUp[] = [];
  const from = levelFromXp(fromXp).level;
  const to = levelFromXp(toXp).level;
  for (let level = from + 1; level <= to; level++) {
    const reward = levelUpReward(level);
    await creditIn(tx, { playerId, amount: reward, type: 'level-up', key: `levelup:${playerId}:${level}` });
    out.push({ playerId, level, reward });
  }
  return out;
}

/** Grant XP outside a hand (e.g. challenge claims), crediting any level-up rewards. */
export async function grantXp(tx: DbOrTx, playerId: string, xp: number): Promise<LevelUp[]> {
  const [row] = await tx.update(players)
    .set({ xp: sql`${players.xp} + ${xp}` })
    .where(eq(players.discordUserId, playerId))
    .returning({ xp: players.xp });
  return row ? applyLevelUps(tx, playerId, row.xp - xp, row.xp) : [];
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

