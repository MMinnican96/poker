import { and, eq, gt, sql } from 'drizzle-orm';
import {
  ACHIEVEMENTS,
  METRICS,
  SHOWCASE_MAX,
  achievementLabel,
  achievementsForMetric,
  autoShowcase,
  formatChips,
  getAchievement,
  getAchievementTitle,
  getItem,
  isPermanent,
  levelFromXp,
  rewardFor,
  tierFor,
  titleUnlockedAt,
  type AchievementDef,
  type AchievementProgress,
  type AchievementUnlock,
  type AchievementsResponse,
  type EventMetricId,
  type HandFact,
  type HandMetricDef,
  type Notice,
  type ProfileTrophies,
  type ShowcaseResult,
} from '@poker/shared';
import type { Db, DbOrTx } from '../db/client.js';
import { playerAchievements, playerAchievementUnlocks, playerItems, players } from '../db/schema.js';
import { creditIn } from './bank.js';
import { grantXp, type LevelUp } from './xp.js';

/**
 * Achievements: career challenges (five tiers) and feats (one tier).
 *
 * Progress lives in `player_achievements`, one row per player and achievement,
 * updated atomically in SQL inside the caller's transaction (the hand's
 * recording, a daily-bonus claim, a challenge claim, a purchase). Reaching a
 * tier inserts a `player_achievement_unlocks` row; only the insert that
 * creates it pays chips (through the bank, one ledger key per tier) and XP.
 */

/** What settling a player's achievements paid out. */
export interface Settled {
  unlocks: AchievementUnlock[];
  /** Levels gained from achievement XP (their chip rewards are already credited). */
  levelUps: LevelUp[];
}

const pa = playerAchievements;
const MAX_SETTLE_ROUNDS = 20;

/** Achievements counted per hand, with their metric definition. */
const HAND_ACHIEVEMENTS: readonly { def: AchievementDef; metric: HandMetricDef }[] = ACHIEVEMENTS.flatMap((def) => {
  const metric = METRICS[def.metric];
  return metric.source === 'hand' ? [{ def, metric }] : [];
});

// ---------------------------------------------------------------------------
// Writes (inside the caller's transaction)
// ---------------------------------------------------------------------------

/**
 * Apply freshly recorded hand facts, then pay any tiers reached. Players are
 * handled in id order, so two recordings sharing players lock rows alike.
 */
export async function applyHandFacts(tx: DbOrTx, facts: readonly HandFact[]): Promise<Settled> {
  const out: Settled = { unlocks: [], levelUps: [] };
  const ids = [...new Set(facts.map((f) => f.playerId))].sort();
  for (const id of ids) {
    for (const f of facts) if (f.playerId === id) await applyHandFact(tx, f);
    merge(out, await settle(tx, id));
  }
  return out;
}

/** One hand's sum and streak updates for one player: at most two statements. */
async function applyHandFact(tx: DbOrTx, f: HandFact): Promise<void> {
  const sums: { achievementId: string; value: number }[] = [];
  const streaks: { achievementId: string; hit: number }[] = [];
  for (const { def, metric } of HAND_ACHIEVEMENTS) {
    const value = metric.hand(f);
    if (metric.mode === 'streak') streaks.push({ achievementId: def.id, hit: value > 0 ? 1 : 0 });
    else if (value !== 0) sums.push({ achievementId: def.id, value });
  }
  if (sums.length > 0) {
    await tx.insert(pa)
      .values(sums.map((s) => ({ playerId: f.playerId, achievementId: s.achievementId, progress: s.value })))
      .onConflictDoUpdate({
        target: [pa.playerId, pa.achievementId],
        set: { progress: sql`${pa.progress} + excluded.progress`, updatedAt: sql`now()` },
      });
  }
  if (streaks.length > 0) {
    // A hit extends the streak, a miss resets it; progress keeps the best.
    const next = sql`case when excluded.current > 0 then ${pa.current} + 1 else 0 end`;
    await tx.insert(pa)
      .values(streaks.map((s) => ({ playerId: f.playerId, achievementId: s.achievementId, progress: s.hit, current: s.hit })))
      .onConflictDoUpdate({
        target: [pa.playerId, pa.achievementId],
        set: { current: next, progress: sql`greatest(${pa.progress}, ${next})`, updatedAt: sql`now()` },
      });
  }
}

/**
 * Feed an event metric (daily streak, challenges claimed, items owned, ...) and
 * pay any tiers reached. `sum` metrics add `value`; `max` metrics keep the
 * larger of the stored and given value.
 */
export async function recordEvent(tx: DbOrTx, playerId: string, metric: EventMetricId, value: number): Promise<Settled> {
  await bumpEvent(tx, playerId, metric, value);
  return settle(tx, playerId);
}

async function bumpEvent(tx: DbOrTx, playerId: string, metric: EventMetricId, value: number): Promise<void> {
  const defs = achievementsForMetric(metric);
  if (defs.length === 0 || !Number.isFinite(value) || value <= 0) return;
  const mode = METRICS[metric].mode;
  await tx.insert(pa)
    .values(defs.map((d) => ({ playerId, achievementId: d.id, progress: value })))
    .onConflictDoUpdate({
      target: [pa.playerId, pa.achievementId],
      set: {
        progress: mode === 'sum' ? sql`${pa.progress} + excluded.progress` : sql`greatest(${pa.progress}, excluded.progress)`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Pay every tier the player's progress has reached but that isn't paid yet.
 * Payouts can move other metrics (XP → `level`, a tier V → `tier-v-count`), so
 * this loops until nothing changes.
 */
export async function settle(tx: DbOrTx, playerId: string): Promise<Settled> {
  const out: Settled = { unlocks: [], levelUps: [] };
  for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
    const [p] = await tx.select({ xp: players.xp }).from(players).where(eq(players.discordUserId, playerId));
    if (!p) return out;
    let rows = await progressRows(tx, playerId);
    const tierV = rows.filter((r) => getAchievement(r.achievementId)?.kind === 'career' && r.tier >= 5).length;
    let fed = false;
    for (const [metric, value] of [['level', levelFromXp(p.xp).level], ['tier-v-count', tierV]] as const) {
      const stale = achievementsForMetric(metric).some((d) => (rows.find((r) => r.achievementId === d.id)?.progress ?? 0) < value);
      if (stale) {
        await bumpEvent(tx, playerId, metric, value);
        fed = true;
      }
    }
    if (fed) rows = await progressRows(tx, playerId);

    let paid = false;
    for (const row of rows) {
      const def = getAchievement(row.achievementId);
      if (!def) continue;
      const reached = tierFor(def, row.progress);
      if (reached <= row.tier) continue;
      for (let tier = row.tier + 1; tier <= reached; tier++) {
        const unlock = await grant(tx, playerId, def, tier, out);
        if (unlock) out.unlocks.push(unlock);
      }
      await tx.update(pa).set({ tier: sql`greatest(${pa.tier}, ${reached})` })
        .where(and(eq(pa.playerId, playerId), eq(pa.achievementId, def.id)));
      paid = true;
    }
    if (!paid) return out;
  }
  return out;
}

/** Record one tier; pay it only if this call created the unlock row. */
async function grant(tx: DbOrTx, playerId: string, def: AchievementDef, tier: number, out: Settled): Promise<AchievementUnlock | null> {
  const inserted = await tx.insert(playerAchievementUnlocks)
    .values({ playerId, achievementId: def.id, tier })
    .onConflictDoNothing()
    .returning({ id: playerAchievementUnlocks.id });
  if (inserted.length === 0) return null;
  const reward = rewardFor(def, tier);
  if (reward.chips > 0) {
    await creditIn(tx, { playerId, amount: reward.chips, type: 'achievement', key: `achievement:${playerId}:${def.id}:${tier}` });
  }
  if (reward.xp > 0) out.levelUps.push(...await grantXp(tx, playerId, reward.xp));
  return {
    playerId, achievementId: def.id, tier, chips: reward.chips, xp: reward.xp,
    titleId: titleUnlockedAt(def, tier)?.id ?? null,
  };
}

function progressRows(tx: DbOrTx, playerId: string) {
  return tx.select({ achievementId: pa.achievementId, progress: pa.progress, current: pa.current, tier: pa.tier })
    .from(pa).where(eq(pa.playerId, playerId));
}

function merge(into: Settled, from: Settled): void {
  into.unlocks.push(...from.unlocks);
  into.levelUps.push(...from.levelUps);
}

/** Progress on one achievement as the backfill computes it. */
export interface FoldedProgress { progress: number; current: number }

/**
 * Fold a player's hand facts (oldest first) into per-achievement progress,
 * exactly as live recording would have: sums add, streaks count consecutive
 * hits and keep the best. Pure.
 */
export function foldFacts(facts: Iterable<HandFact>, into = new Map<string, FoldedProgress>()): Map<string, FoldedProgress> {
  for (const f of facts) {
    for (const { def, metric } of HAND_ACHIEVEMENTS) {
      const value = metric.hand(f);
      const cur = into.get(def.id) ?? { progress: 0, current: 0 };
      if (metric.mode === 'streak') {
        cur.current = value > 0 ? cur.current + 1 : 0;
        cur.progress = Math.max(cur.progress, cur.current);
      } else {
        cur.progress += value;
      }
      into.set(def.id, cur);
    }
  }
  return into;
}

/**
 * Backfill writes: progress becomes the larger of stored and computed (never
 * lower). The streak in progress comes from the fold only for a new row; an
 * existing row keeps its own, because live hands may have moved it since the
 * fold read the facts (a stale snapshot must not restore an old streak).
 * Tiers are paid by `settle` afterwards.
 */
export async function writeFolded(tx: DbOrTx, playerId: string, folded: ReadonlyMap<string, FoldedProgress>): Promise<void> {
  const values = [...folded].filter(([id, v]) => getAchievement(id) && (v.progress > 0 || v.current > 0))
    .map(([achievementId, v]) => ({ playerId, achievementId, progress: v.progress, current: v.current }));
  if (values.length === 0) return;
  await tx.insert(pa).values(values).onConflictDoUpdate({
    target: [pa.playerId, pa.achievementId],
    set: { progress: sql`greatest(${pa.progress}, excluded.progress)`, updatedAt: sql`now()` },
  });
}

/** Distinct permanent, paid shop items a player owns (the `items-owned` metric). */
export async function countOwnedItems(tx: DbOrTx, playerId: string): Promise<number> {
  const rows = await tx.select({ itemId: playerItems.itemId }).from(playerItems)
    .where(and(eq(playerItems.playerId, playerId), gt(playerItems.quantity, 0)));
  return new Set(rows.map((r) => r.itemId).filter((id) => {
    const item = getItem(id);
    return !!item && isPermanent(item) && item.price > 0;
  })).size;
}

/** True when the player has reached the tier that unlocks this achievement title (`ach:...`). */
export async function hasAchievementTitle(db: DbOrTx, playerId: string, titleId: string): Promise<boolean> {
  const title = getAchievementTitle(titleId);
  if (!title) return false;
  const [row] = await db.select({ tier: pa.tier }).from(pa)
    .where(and(eq(pa.playerId, playerId), eq(pa.achievementId, title.achievementId)));
  return (row?.tier ?? 0) >= title.tier;
}

// ---------------------------------------------------------------------------
// Copy for notices and the activity feed
// ---------------------------------------------------------------------------

/** The toast for an unlock, e.g. "Grinder III" / "+2,500 chips and 200 XP. New title: Regular." */
export function unlockNotice(u: AchievementUnlock): Omit<Notice, 'id'> {
  const def = getAchievement(u.achievementId);
  const name = def ? (def.kind === 'feat' ? `Feat unlocked: ${def.name}` : achievementLabel(def, u.tier)) : 'Emblem unlocked';
  const title = u.titleId ? getAchievementTitle(u.titleId) : undefined;
  const body = `+${formatChips(u.chips)} chips and ${formatChips(u.xp)} XP.${title ? ` New title: ${title.text}.` : ''}`;
  return { tone: 'good', title: name, body, emblem: { achievementId: u.achievementId, tier: u.tier } };
}

/** Room-feed text for feats and tier V only; null for the rest. */
export function unlockActivityText(u: AchievementUnlock): string | null {
  const def = getAchievement(u.achievementId);
  if (!def) return null;
  if (def.kind === 'feat') return `earned the “${def.name}” feat`;
  return u.tier >= 5 ? `reached ${achievementLabel(def, 5)}` : null;
}

// ---------------------------------------------------------------------------
// Reads and the showcase
// ---------------------------------------------------------------------------

export class AchievementService {
  constructor(private readonly db: Db) {}

  /** Every achievement in the catalog with the player's progress (zeros when untouched). */
  async forPlayer(playerId: string): Promise<AchievementsResponse> {
    const [rows, unlocks, [p]] = await Promise.all([
      progressRows(this.db, playerId),
      this.unlockRows(playerId),
      this.db.select({ showcase: players.showcase }).from(players).where(eq(players.discordUserId, playerId)),
    ]);
    const byId = new Map(rows.map((r) => [r.achievementId, r]));
    const achievements: AchievementProgress[] = ACHIEVEMENTS.map((def) => {
      const row = byId.get(def.id);
      return {
        id: def.id,
        progress: row?.progress ?? 0,
        tier: row?.tier ?? 0,
        unlocks: unlocks.filter((u) => u.achievementId === def.id)
          .map((u) => ({ tier: u.tier, unlockedAt: u.unlockedAt.toISOString() }))
          .sort((a, b) => a.tier - b.tier),
      };
    });
    return { achievements, showcase: p?.showcase ?? [] };
  }

  /** The trophy cabinet for a profile card. */
  async trophies(playerId: string): Promise<ProfileTrophies> {
    const [unlocks, [p]] = await Promise.all([
      this.unlockRows(playerId),
      this.db.select({ showcase: players.showcase }).from(players).where(eq(players.discordUserId, playerId)),
    ]);
    const best = new Map<string, { id: string; tier: number; unlockedAt: string }>();
    for (const u of unlocks) {
      if (!getAchievement(u.achievementId)) continue;
      const prev = best.get(u.achievementId);
      if (!prev || u.tier > prev.tier) best.set(u.achievementId, { id: u.achievementId, tier: u.tier, unlockedAt: u.unlockedAt.toISOString() });
    }
    const unlocked = [...best.values()];
    const chosen = (p?.showcase ?? []).filter((id) => best.has(id));
    const auto = chosen.length === 0;
    return {
      showcase: auto ? autoShowcase(unlocked, SHOWCASE_MAX) : chosen,
      auto,
      unlocked,
      emblems: unlocked.length,
      total: ACHIEVEMENTS.length,
    };
  }

  /** Pin up to five unlocked emblems, in order. An empty list goes back to the automatic pick. */
  async setShowcase(playerId: string, ids: unknown): Promise<ShowcaseResult> {
    if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
      return { ok: false, error: 'Choose the emblems to show.' };
    }
    if (ids.length > SHOWCASE_MAX) return { ok: false, error: `You can show up to ${SHOWCASE_MAX} emblems.` };
    if (new Set(ids).size !== ids.length) return { ok: false, error: 'Each emblem can only go on the shelf once.' };
    if (!ids.every((id) => getAchievement(id))) return { ok: false, error: "That emblem doesn't exist." };
    if (ids.length > 0) {
      const rows = await progressRows(this.db, playerId);
      const unlocked = new Set(rows.filter((r) => r.tier > 0).map((r) => r.achievementId));
      if (!ids.every((id) => unlocked.has(id))) return { ok: false, error: "You haven't unlocked that emblem yet." };
    }
    const updated = await this.db.update(players).set({ showcase: ids })
      .where(eq(players.discordUserId, playerId)).returning({ showcase: players.showcase });
    if (updated.length === 0) return { ok: false, error: 'Unknown player.' };
    return { ok: true, showcase: updated[0].showcase };
  }

  hasTitle(playerId: string, titleId: string): Promise<boolean> {
    return hasAchievementTitle(this.db, playerId, titleId);
  }

  private unlockRows(playerId: string) {
    return this.db.select().from(playerAchievementUnlocks).where(eq(playerAchievementUnlocks.playerId, playerId));
  }
}
