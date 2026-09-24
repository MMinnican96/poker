import { eq, sql } from 'drizzle-orm';
import { levelFromXp, levelUpReward } from '@poker/shared';
import type { DbOrTx } from '../db/client.js';
import { players } from '../db/schema.js';
import { creditIn } from './bank.js';

export interface LevelUp { playerId: string; level: number; reward: number }

/** Credit a chip reward for every level crossed between two XP totals. */
export async function applyLevelUps(tx: DbOrTx, playerId: string, fromXp: number, toXp: number): Promise<LevelUp[]> {
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

/**
 * Grant XP inside a transaction, crediting any level-up rewards. The `level`
 * achievement metric is fed separately (achievements read the level from XP
 * whenever they settle), so this stays free of achievement imports.
 */
export async function grantXp(tx: DbOrTx, playerId: string, xp: number): Promise<LevelUp[]> {
  const [row] = await tx.update(players)
    .set({ xp: sql`${players.xp} + ${xp}` })
    .where(eq(players.discordUserId, playerId))
    .returning({ xp: players.xp });
  return row ? applyLevelUps(tx, playerId, row.xp - xp, row.xp) : [];
}
