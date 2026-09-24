import { eq, inArray } from 'drizzle-orm';
import { cosmeticsFor, levelFromXp, type Loadout, type PublicPlayer } from '@poker/shared';
import type { DbOrTx } from '../db/client.js';
import { players, type Player } from '../db/schema.js';

export function loadoutOf(row: Player): Loadout {
  return {
    felt: row.loadoutFelt,
    'card-back': row.loadoutCardBack,
    frame: row.loadoutFrame,
    title: row.loadoutTitle,
    celebration: row.loadoutCelebration,
  };
}

export function toPublic(row: Player): PublicPlayer {
  return {
    id: row.discordUserId,
    name: row.displayName,
    avatarUrl: row.avatarUrl ?? '',
    level: levelFromXp(row.xp).level,
    cosmetics: cosmeticsFor(loadoutOf(row)),
  };
}

export async function getPlayerRow(db: DbOrTx, id: string): Promise<Player | null> {
  const [row] = await db.select().from(players).where(eq(players.discordUserId, id));
  return row ?? null;
}

export async function getPublicPlayers(db: DbOrTx, ids: string[]): Promise<Map<string, PublicPlayer>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(players).where(inArray(players.discordUserId, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.discordUserId, toPublic(r)]));
}
