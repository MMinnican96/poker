import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  activeChallenges,
  dailyBonusAmount,
  dayKey,
  getChallenge,
  periodEndsAt,
  periodKeyFor,
  type ChallengePeriod,
  type ChallengeStatus,
} from '@poker/shared';
import type { Db } from '../db/client.js';
import { playerChallenges, players } from '../db/schema.js';
import { creditIn, lockBalance } from './bank.js';
import { grantXp, type LevelUp } from './recorder.js';

export type RewardResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DailyStatus {
  available: boolean;
  /** The streak day the next claim counts as. */
  streak: number;
  nextAmount: number;
}

function previousDay(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
}

/** Daily bonus and challenge rewards. */
export class RewardsService {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async dailyStatus(playerId: string): Promise<DailyStatus> {
    const [row] = await this.db.select({ last: players.lastDailyClaim, streak: players.dailyStreak })
      .from(players).where(eq(players.discordUserId, playerId));
    return dailyFrom(row?.last ?? null, row?.streak ?? 0, dayKey(this.clock()));
  }

  /** Claim today's bonus. Consecutive days grow the streak; a missed day resets it. */
  async claimDaily(playerId: string): Promise<RewardResult<{ amount: number; balance: number; streak: number }>> {
    const today = dayKey(this.clock());
    return this.db.transaction(async (tx) => {
      if ((await lockBalance(tx, playerId)) === null) return { ok: false, error: 'Unknown player.' };
      const [row] = await tx.select({ last: players.lastDailyClaim, streak: players.dailyStreak })
        .from(players).where(eq(players.discordUserId, playerId));
      const status = dailyFrom(row.last, row.streak, today);
      if (!status.available) return { ok: false, error: 'You already claimed today’s bonus. Come back tomorrow.' };
      const credit = await creditIn(tx, { playerId, amount: status.nextAmount, type: 'daily-bonus', key: `daily:${playerId}:${today}` });
      await tx.update(players).set({ lastDailyClaim: today, dailyStreak: status.streak })
        .where(eq(players.discordUserId, playerId));
      return { ok: true, amount: status.nextAmount, balance: credit.balance, streak: status.streak };
    });
  }

  /** This period's challenges with the player's progress. */
  async challenges(playerId: string): Promise<ChallengeStatus[]> {
    const now = this.clock();
    const periods: ChallengePeriod[] = ['daily', 'weekly'];
    const out: ChallengeStatus[] = [];
    for (const period of periods) {
      const periodKey = periodKeyFor(period, now);
      const defs = activeChallenges(period, periodKey);
      const rows = await this.db.select().from(playerChallenges).where(and(
        eq(playerChallenges.playerId, playerId),
        eq(playerChallenges.periodKey, periodKey),
        inArray(playerChallenges.challengeId, defs.map((d) => d.id)),
      ));
      const byId = new Map(rows.map((r) => [r.challengeId, r]));
      for (const def of defs) {
        const row = byId.get(def.id);
        out.push({
          id: def.id,
          period,
          periodKey,
          title: def.title,
          description: def.description,
          goal: def.goal,
          progress: Math.max(0, Math.min(def.goal, Math.floor(row?.progress ?? 0))),
          completed: !!row?.completedAt,
          claimed: !!row?.claimedAt,
          reward: def.reward,
          endsAt: periodEndsAt(period, now).toISOString(),
        });
      }
    }
    return out;
  }

  async unclaimedCount(playerId: string): Promise<number> {
    const now = this.clock();
    const keys = [periodKeyFor('daily', now), periodKeyFor('weekly', now)];
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(playerChallenges).where(and(
      eq(playerChallenges.playerId, playerId),
      inArray(playerChallenges.periodKey, keys),
      isNotNull(playerChallenges.completedAt),
      isNull(playerChallenges.claimedAt),
    ));
    return Number(row?.n ?? 0);
  }

  /** Claim a completed challenge's chips and XP (once). */
  async claimChallenge(playerId: string, periodKey: string, challengeId: string): Promise<RewardResult<{
    chips: number; xp: number; balance: number; levelUps: LevelUp[];
  }>> {
    const def = getChallenge(challengeId);
    if (!def) return { ok: false, error: 'Unknown challenge.' };
    return this.db.transaction(async (tx) => {
      if ((await lockBalance(tx, playerId)) === null) return { ok: false, error: 'Unknown player.' };
      const [row] = await tx.select().from(playerChallenges).where(and(
        eq(playerChallenges.playerId, playerId),
        eq(playerChallenges.periodKey, periodKey),
        eq(playerChallenges.challengeId, challengeId),
      )).for('update');
      if (!row?.completedAt) return { ok: false, error: 'Finish the challenge first.' };
      if (row.claimedAt) return { ok: false, error: 'Already claimed.' };
      await tx.update(playerChallenges).set({ claimedAt: this.clock() }).where(eq(playerChallenges.id, row.id));
      await creditIn(tx, {
        playerId, amount: def.reward.chips, type: 'challenge', key: `challenge:${playerId}:${periodKey}:${challengeId}`,
      });
      const levelUps = await grantXp(tx, playerId, def.reward.xp);
      const [after] = await tx.select({ b: players.chipBalance }).from(players).where(eq(players.discordUserId, playerId));
      return { ok: true, chips: def.reward.chips, xp: def.reward.xp, balance: after.b, levelUps };
    });
  }
}

function dailyFrom(last: string | null, streak: number, today: string): DailyStatus {
  if (last === today) return { available: false, streak, nextAmount: dailyBonusAmount(streak + 1) };
  const next = last === previousDay(today) ? streak + 1 : 1;
  return { available: true, streak: next, nextAmount: dailyBonusAmount(next) };
}
