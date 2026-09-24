import { and, eq, sql } from 'drizzle-orm';
import {
  getItem,
  getTitle,
  isPermanent,
  levelFromXp,
  type AchievementUnlock,
  type Loadout,
  type LoadoutSlot,
  type ShopItem,
} from '@poker/shared';
import type { Db } from '../db/client.js';
import { chipTransactions, playerItems, players } from '../db/schema.js';
import { countOwnedItems, hasAchievementTitle, recordEvent } from './achievements.js';
import { lockBalance, move } from './bank.js';
import type { LevelUp } from './xp.js';
import { loadoutOf } from './players.js';

export type ShopResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const SLOT_OF: Partial<Record<ShopItem['category'], LoadoutSlot>> = {
  felt: 'felt', 'card-back': 'card-back', frame: 'frame', title: 'title', celebration: 'celebration',
};

const SLOT_COLUMN = {
  felt: 'loadoutFelt',
  'card-back': 'loadoutCardBack',
  frame: 'loadoutFrame',
  title: 'loadoutTitle',
  celebration: 'loadoutCelebration',
} as const satisfies Record<LoadoutSlot, keyof typeof players.$inferSelect>;

export class ShopService {
  constructor(private readonly db: Db) {}

  /** Owned item id → quantity (free items are implied, not stored). */
  async owned(playerId: string): Promise<Record<string, number>> {
    const rows = await this.db.select().from(playerItems).where(eq(playerItems.playerId, playerId));
    return Object.fromEntries(rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]));
  }

  async owns(playerId: string, itemId: string): Promise<boolean> {
    const item = getItem(itemId);
    if (!item) return false;
    if (item.price === 0) return true;
    const [row] = await this.db.select({ q: playerItems.quantity }).from(playerItems)
      .where(and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId)));
    return (row?.q ?? 0) > 0;
  }

  /**
   * Buy an item. `nonce` is a client-generated id: retrying the same purchase
   * returns success without charging twice.
   */
  async purchase(playerId: string, itemId: string, nonce: string): Promise<ShopResult<{
    balance: number; quantity: number; levelUps: LevelUp[]; unlocks: AchievementUnlock[];
  }>> {
    const item = getItem(itemId);
    if (!item) return { ok: false, error: 'That item is not in the shop.' };
    if (item.price === 0) return { ok: false, error: 'That item is free — it is already yours.' };
    if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce)) return { ok: false, error: 'Invalid purchase id.' };
    const key = `purchase:${playerId}:${nonce}`;

    return this.db.transaction(async (tx) => {
      const balance = await lockBalance(tx, playerId);
      if (balance === null) return { ok: false, error: 'Unknown player.' };

      const [already] = await tx.select({ id: chipTransactions.id }).from(chipTransactions)
        .where(eq(chipTransactions.idempotencyKey, key));
      const [held] = await tx.select().from(playerItems)
        .where(and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId)));
      if (already) return { ok: true, balance, quantity: held?.quantity ?? 0, levelUps: [], unlocks: [] };

      if (isPermanent(item) && (held?.quantity ?? 0) > 0) return { ok: false, error: 'You already own this.' };
      const [p] = await tx.select({ xp: players.xp }).from(players).where(eq(players.discordUserId, playerId));
      if (item.minLevel && levelFromXp(p.xp).level < item.minLevel) {
        return { ok: false, error: `Reach level ${item.minLevel} to buy this.` };
      }
      if (balance < item.price) return { ok: false, error: `You need ${item.price - balance} more chips.` };

      const next = await move(tx, playerId, -item.price, 'purchase', key);
      const grant = item.quantity ?? 1;
      const [row] = await tx.insert(playerItems).values({ playerId, itemId, quantity: grant })
        .onConflictDoUpdate({
          target: [playerItems.playerId, playerItems.itemId],
          set: { quantity: isPermanent(item) ? 1 : sql`${playerItems.quantity} + ${grant}` },
        })
        .returning({ quantity: playerItems.quantity });
      const settled = await recordEvent(tx, playerId, 'items-owned', await countOwnedItems(tx, playerId));
      const [after] = settled.unlocks.length > 0 || settled.levelUps.length > 0
        ? await tx.select({ b: players.chipBalance }).from(players).where(eq(players.discordUserId, playerId))
        : [{ b: next }];
      return { ok: true, balance: after.b, quantity: row.quantity, levelUps: settled.levelUps, unlocks: settled.unlocks };
    });
  }

  /**
   * Equip an item. The title slot also takes titles earned from achievements
   * (`ach:...`) once the player has reached the tier that unlocks them.
   */
  async equip(playerId: string, slot: LoadoutSlot, itemId: string): Promise<ShopResult<{ loadout: Loadout }>> {
    const earned = slot === 'title' ? getTitle(itemId) : undefined;
    if (earned?.source === 'achievement') {
      if (!(await hasAchievementTitle(this.db, playerId, itemId))) return { ok: false, error: "You haven't earned that title yet." };
    } else {
      const item = getItem(itemId);
      if (!item || SLOT_OF[item.category] !== slot) return { ok: false, error: "That item doesn't go in that slot." };
      if (!(await this.owns(playerId, itemId))) return { ok: false, error: "You don't own that yet." };
    }
    const [row] = await this.db.update(players)
      .set({ [SLOT_COLUMN[slot]]: itemId })
      .where(eq(players.discordUserId, playerId))
      .returning();
    if (!row) return { ok: false, error: 'Unknown player.' };
    return { ok: true, loadout: loadoutOf(row) };
  }

  /** Use one consumable. False when the player has none left. */
  async consume(playerId: string, itemId: string): Promise<boolean> {
    const rows = await this.db.update(playerItems)
      .set({ quantity: sql`${playerItems.quantity} - 1` })
      .where(and(eq(playerItems.playerId, playerId), eq(playerItems.itemId, itemId), sql`${playerItems.quantity} > 0`))
      .returning({ q: playerItems.quantity });
    return rows.length > 0;
  }
}
