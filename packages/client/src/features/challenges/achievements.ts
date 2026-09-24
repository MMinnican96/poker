/** Joins the server's achievement progress with the shared catalog for the screens. */
import {
  ACHIEVEMENTS,
  achievementTitles,
  autoShowcase,
  type AchievementDef,
  type AchievementProgress,
  type AchievementTitle,
  type AchievementsResponse,
  type UnlockedEmblem,
} from '@poker/shared';

export interface Standing {
  def: AchievementDef;
  progress: number;
  /** 0 = locked. */
  tier: number;
  /** When the current tier was reached (ISO), or null. */
  unlockedAt: string | null;
}

const EMPTY: Omit<AchievementProgress, 'id'> = { progress: 0, tier: 0, unlocks: [] };

/** Every catalog achievement with the player's progress (zeros when the server sent none). */
export function standings(res: AchievementsResponse | undefined): Map<string, Standing> {
  const byId = new Map((res?.achievements ?? []).map((p) => [p.id, p]));
  return new Map(ACHIEVEMENTS.map((def) => {
    const p = byId.get(def.id) ?? { id: def.id, ...EMPTY };
    const tier = Math.max(0, Math.min(def.goals.length, Math.floor(p.tier)));
    const at = p.unlocks.find((u) => u.tier === tier)?.unlockedAt ?? null;
    return [def.id, { def, progress: Math.max(0, p.progress), tier, unlockedAt: tier > 0 ? at : null }];
  }));
}

/** Unlocked achievements, each once at its current tier. */
export function unlockedEmblems(all: Map<string, Standing>): UnlockedEmblem[] {
  return [...all.values()]
    .filter((s) => s.tier > 0)
    .map((s) => ({ id: s.def.id, tier: s.tier, unlockedAt: s.unlockedAt ?? '' }));
}

/** The shelf: the chosen showcase (unlocked ids only), or the automatic pick when none is chosen. */
export function shelfOf(all: Map<string, Standing>, chosen: readonly string[]): { ids: string[]; auto: boolean } {
  const picked = chosen.filter((id) => (all.get(id)?.tier ?? 0) > 0);
  if (chosen.length > 0) return { ids: picked, auto: false };
  return { ids: autoShowcase(unlockedEmblems(all)), auto: true };
}

/** Achievement titles the player has earned, lowest tier first within each achievement. */
export function earnedTitles(all: Map<string, Standing>): AchievementTitle[] {
  return [...all.values()].flatMap((s) => achievementTitles(s.def).filter((t) => s.tier >= t.tier));
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Sep 24, 2026", or '' for a missing or bad date. */
export function unlockDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}
