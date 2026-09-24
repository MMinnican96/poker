/**
 * Achievements: tiered career challenges and one-off feats. Static data shared
 * by the server (progress, unlocks, rewards, titles) and the client (emblems,
 * copy). Progress on each comes from one metric in the registry (metrics.ts).
 *
 * Player-facing copy says "career challenges", "feats", "emblems", "titles"
 * and "trophy cabinet"; "achievement" is the code name for both kinds.
 */
import { formatChips } from './format.js';
import type { MetricId } from './metrics.js';
import type { Rarity } from './shop.js';

export type AchievementKind = 'career' | 'feat';

/** Career tiers 1..5 (I Bronze .. V Diamond). Tier 0 = locked. */
export type CareerTier = 1 | 2 | 3 | 4 | 5;

export type CareerGroupId = 'grind' | 'winning' | 'big-game' | 'aggression' | 'made-hands' | 'hole-cards' | 'club';

/** Career groups in on-screen order. */
export const CAREER_GROUPS: readonly { id: CareerGroupId; name: string }[] = [
  { id: 'grind', name: 'Grind' },
  { id: 'winning', name: 'Winning' },
  { id: 'big-game', name: 'Big game' },
  { id: 'aggression', name: 'Aggression' },
  { id: 'made-hands', name: 'Made hands' },
  { id: 'hole-cards', name: 'Hole cards' },
  { id: 'club', name: 'Club' },
];

/**
 * The concept drawn in the middle of an emblem, one per achievement. The
 * client maps each key to an icon (a missing key fails its type-check).
 */
export type EmblemGlyph =
  // Career
  | 'armchair' | 'card-fan' | 'owl' | 'money-bag' | 'spotlight' | 'robber-mask' | 'coin-stack'
  | 'fish' | 'fist' | 'mousetrap' | 'upward-arrows' | 'captain-hat' | 'claws' | 'bear-trap'
  | 'pickaxe' | 'arrow' | 'water-splash' | 'anchor' | 'four-leaf-clover' | 'knapsack' | 'bow-tie'
  | 'horseshoe' | 'throne' | 'alarm-clock' | 'scroll' | 'treasure-chest'
  // Feats
  | 'cheese' | 'cleaver' | 'stone-block' | 'wheel' | 'hammer' | 'cracked-shield' | 'snake-bite'
  | 'rocket' | 'flame' | 'podium' | 'rainbow' | 'horse-head' | 'whale' | 'bird' | 'moon'
  | 'angel-wings' | 'crown' | 'meteor' | 'laurel-trophy';

/** Metal colours for a gradient: highlight, body, shadow (hex). */
export interface MetalColours { light: string; base: string; dark: string }

export interface TierInfo {
  tier: CareerTier;
  /** "Bronze" .. "Diamond". */
  name: string;
  /** "I" .. "V". */
  roman: string;
  chips: number;
  xp: number;
  colours: MetalColours;
}

/** Tier names, numerals, rewards and metals; the same for every career challenge. */
export const TIER_INFO: Readonly<Record<CareerTier, TierInfo>> = {
  1: { tier: 1, name: 'Bronze', roman: 'I', chips: 500, xp: 50,
    colours: { light: '#f0b27a', base: '#b5702f', dark: '#6b3d17' } },
  2: { tier: 2, name: 'Silver', roman: 'II', chips: 1000, xp: 100,
    colours: { light: '#f5f7fa', base: '#b9c0c8', dark: '#69717b' } },
  3: { tier: 3, name: 'Gold', roman: 'III', chips: 2500, xp: 200,
    colours: { light: '#fff1a8', base: '#e3b347', dark: '#8a6414' } },
  4: { tier: 4, name: 'Platinum', roman: 'IV', chips: 5000, xp: 350,
    colours: { light: '#f4f9fc', base: '#c7d5df', dark: '#71879a' } },
  5: { tier: 5, name: 'Diamond', roman: 'V', chips: 10000, xp: 600,
    colours: { light: '#eafcff', base: '#7fd6f0', dark: '#2a7ea3' } },
};

export const CAREER_TIERS: readonly CareerTier[] = [1, 2, 3, 4, 5];

/** Tier info for a numeric tier (clamped to 1..5). */
export function tierInfo(tier: number): TierInfo {
  const t = Math.min(5, Math.max(1, Math.floor(tier))) as CareerTier;
  return TIER_INFO[t];
}

/** Feat colours by rarity, same shape as the metals. */
export const RARITY_COLOURS: Readonly<Record<Rarity, MetalColours>> = {
  common: { light: '#d7dee4', base: '#8e9aa5', dark: '#4a545e' },
  rare: { light: '#9fd0ff', base: '#3d82d6', dark: '#1b3f73' },
  epic: { light: '#dcb4ff', base: '#9b5de5', dark: '#4b2275' },
  legendary: { light: '#ffe08a', base: '#f29f22', dark: '#8c4a0b' },
};

export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_NAME: Readonly<Record<Rarity, string>> = {
  common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary',
};

interface AchievementBase {
  id: string;
  name: string;
  metric: MetricId;
  glyph: EmblemGlyph;
}

export interface CareerDef extends AchievementBase {
  kind: 'career';
  group: CareerGroupId;
  /**
   * Goal sentence. `{n}` is the goal; `[one|many]` picks a word by it
   * (singular when the goal is 1).
   */
  template: string;
  /** Goals for tiers I..V, strictly ascending, in the metric's units. */
  goals: readonly [number, number, number, number, number];
  /** Shown goal = stored goal / divisor (night owl stores minutes, shows hours). */
  displayDivisor?: number;
  /** Title texts unlocked at tier III and tier V. */
  titles: { 3: string; 5: string };
}

export interface FeatDef extends AchievementBase {
  kind: 'feat';
  description: string;
  goals: readonly [number];
  reward: { chips: number; xp: number };
  rarity: Rarity;
  /** Secret feats show "Secret feat" and the hint until unlocked. */
  secret: boolean;
  hint?: string;
  title: string;
}

export type AchievementDef = CareerDef | FeatDef;

const career = (
  id: string, group: CareerGroupId, name: string, template: string, metric: MetricId,
  goals: CareerDef['goals'], title3: string, title5: string, glyph: EmblemGlyph,
  extra: Partial<Pick<CareerDef, 'displayDivisor'>> = {},
): CareerDef => ({ kind: 'career', id, group, name, template, metric, goals, titles: { 3: title3, 5: title5 }, glyph, ...extra });

const feat = (
  id: string, name: string, description: string, metric: MetricId, goal: number,
  chips: number, xp: number, rarity: Rarity, title: string, glyph: EmblemGlyph, hint?: string,
): FeatDef => ({
  kind: 'feat', id, name, description, metric, goals: [goal], reward: { chips, xp }, rarity,
  secret: hint !== undefined, ...(hint !== undefined ? { hint } : {}), title, glyph,
});

export const CAREER_CHALLENGES: readonly CareerDef[] = [
  // Grind
  career('grinder', 'grind', 'Grinder', 'Play {n} [hand|hands].', 'hands-played',
    [50, 250, 1000, 5000, 20000], 'Regular', 'Furniture', 'armchair'),
  career('flop-chaser', 'grind', 'Flop chaser', 'See {n} [flop|flops].', 'flops-seen',
    [25, 150, 600, 2500, 10000], 'Flop chaser', 'Board certified', 'card-fan'),
  career('night-owl', 'grind', 'Night owl', 'Spend {n} [hour|hours] in hands.', 'minutes-played',
    [60, 300, 1500, 6000, 30000], 'Night owl', 'Lives here', 'owl', { displayDivisor: 60 }),
  // Winning
  career('pot-taker', 'winning', 'Pot taker', 'Win {n} [hand|hands].', 'hands-won',
    [25, 150, 600, 2500, 10000], 'Pot taker', 'The bank', 'money-bag'),
  career('showstopper', 'winning', 'Showstopper', 'Win {n} [hand|hands] at showdown.', 'showdowns-won',
    [10, 60, 250, 1000, 4000], 'Show pony', 'Showstopper', 'spotlight'),
  career('pickpocket', 'winning', 'Pickpocket', 'Win {n} [hand|hands] without a showdown.', 'steals',
    [15, 100, 400, 1500, 6000], 'Pickpocket', 'Cat burglar', 'robber-mask'),
  career('money-maker', 'winning', 'Money maker', 'Win {n} big [blind|blinds] in winning hands.', 'bb-won',
    [100, 500, 2500, 10000, 50000], 'Money maker', 'Tycoon', 'coin-stack'),
  // Big game
  career('big-fish', 'big-game', 'Big fish', 'Win {n} [pot|pots] of 50 big blinds or more.', 'pots-50bb',
    [1, 10, 50, 200, 750], 'Big fish', 'Whale', 'fish'),
  career('shover', 'big-game', 'Shover', 'Win {n} [hand|hands] where you went all-in.', 'all-in-wins',
    [1, 10, 40, 150, 500], 'Shover', 'Nerves of steel', 'fist'),
  career('rat-catcher', 'big-game', 'Rat catcher', 'Bust {n} [player|players].', 'knockouts',
    [1, 10, 50, 200, 750], 'Rat catcher', 'Pied piper', 'mousetrap'),
  career('double-up', 'big-game', 'Double up', 'Double your stack in a hand {n} [time|times].', 'double-ups',
    [1, 5, 25, 100, 300], 'Double trouble', 'Compound interest', 'upward-arrows'),
  // Aggression
  career('table-captain', 'aggression', 'Table captain', 'Raise before the flop in {n} [hand|hands].', 'preflop-raises',
    [25, 150, 600, 2500, 10000], 'Table captain', 'The aggressor', 'captain-hat'),
  career('re-raiser', 'aggression', 'Re-raiser', 'Three-bet {n} [time|times].', 'three-bets',
    [5, 30, 120, 500, 2000], 'Re-raiser', 'Three-bet menace', 'claws'),
  career('trapper', 'aggression', 'Trapper', 'Check-raise {n} [time|times].', 'check-raises',
    [1, 10, 40, 150, 600], 'Trapper', 'Snake in the grass', 'bear-trap'),
  // Made hands
  career('set-miner', 'made-hands', 'Set miner', 'Win {n} [showdown|showdowns] with three of a kind or better.', 'wins-trips-plus',
    [5, 25, 100, 400, 1500], 'Set miner', 'Triple threat', 'pickaxe'),
  career('straight-shooter', 'made-hands', 'Straight shooter', 'Win {n} [showdown|showdowns] with a straight.', 'wins-straight',
    [3, 15, 60, 250, 1000], 'Straight shooter', 'Straight and narrow', 'arrow'),
  career('flusher', 'made-hands', 'Flusher', 'Win {n} [showdown|showdowns] with a flush.', 'wins-flush',
    [3, 15, 60, 250, 1000], 'Flush with cash', 'Suited and booted', 'water-splash'),
  career('boat-captain', 'made-hands', 'Boat captain', 'Win {n} [showdown|showdowns] with a full house.', 'wins-full-house',
    [1, 5, 25, 100, 400], 'Boat captain', 'Admiral', 'anchor'),
  career('quadfather', 'made-hands', 'Quadfather', 'Win {n} [showdown|showdowns] with four of a kind.', 'wins-quads',
    [1, 3, 10, 25, 60], 'Quadfather', 'Quad god', 'four-leaf-clover'),
  // Hole cards
  career('deep-pockets', 'hole-cards', 'Deep pockets', 'Win {n} [showdown|showdowns] with a pocket pair.', 'pocket-pair-wins',
    [10, 50, 200, 800, 3000], 'Deep pockets', 'Pocket monster', 'knapsack'),
  career('well-suited', 'hole-cards', 'Well suited', 'Win {n} [showdown|showdowns] with suited hole cards.', 'suited-wins',
    [10, 50, 200, 800, 3000], 'Suit and tie', 'Well suited', 'bow-tie'),
  career('river-rat', 'hole-cards', 'River rat', 'Win {n} [showdown|showdowns] you were behind in after the turn.', 'suckouts',
    [1, 10, 40, 150, 500], 'Lucky rat', 'River rat', 'horseshoe'),
  // Club
  career('made-rat', 'club', 'Made rat', 'Reach level {n}.', 'level',
    [5, 10, 25, 50, 100], 'Made rat', 'Rat king', 'throne'),
  career('clockwork', 'club', 'Clockwork', 'Claim the daily bonus {n} [day|days] in a row.', 'daily-streak',
    [3, 7, 14, 30, 100], 'Clockwork', 'Never misses', 'alarm-clock'),
  career('contractor', 'club', 'Contractor', 'Claim {n} daily or weekly [challenge|challenges].', 'challenges-claimed',
    [5, 25, 100, 300, 1000], 'Contractor', 'Overachiever', 'scroll'),
  career('collector', 'club', 'Collector', 'Own {n} shop [item|items].', 'items-owned',
    [2, 5, 10, 18, 26], 'Collector', 'Completionist', 'treasure-chest'),
];

export const FEATS: readonly FeatDef[] = [
  feat('fresh-cheese', 'Fresh cheese', 'Win your first hand.', 'hands-won', 1, 250, 25, 'common', 'Fresh cheese', 'cheese'),
  feat('fair-share', 'Fair share', 'Split a pot at showdown.', 'split-pots', 1, 1000, 100, 'common', 'Fair share', 'cleaver'),
  feat('the-rock', 'The rock', 'Fold 30 hands in a row.', 'fold-streak', 30, 1500, 100, 'common', 'The rock', 'stone-block',
    'Patience is a virtue.'),
  feat('wheelie', 'Wheelie', 'Win at showdown with a five-high straight.', 'wins-wheel', 1, 3000, 250, 'rare', 'Wheelie', 'wheel'),
  feat('the-hammer', 'The hammer', 'Win at showdown with seven-deuce offsuit.', 'seven-deuce-wins', 1, 5000, 400, 'rare', 'The hammer', 'hammer',
    'The worst hand in poker has its day.'),
  feat('cracked', 'Cracked', 'Lose at showdown holding pocket aces.', 'aces-cracked', 1, 2500, 200, 'rare', 'Aces cracked', 'cracked-shield',
    'Even the best hand loses sometimes.'),
  feat('snakebit', 'Snakebit', 'Lose at showdown with a full house or better.', 'bad-beats', 1, 5000, 400, 'rare', 'Snakebit', 'snake-bite'),
  feat('rockets', 'Rockets', 'Win a pre-flop all-in holding pocket aces.', 'rockets-all-in-wins', 1, 3000, 250, 'rare', 'Rocket man', 'rocket'),
  feat('on-a-heater', 'On a heater', 'Win 5 hands in a row.', 'win-streak', 5, 5000, 400, 'rare', 'Heater', 'flame'),
  feat('last-rat-standing', 'Last rat standing', 'Win a showdown against three or more opponents.', 'multiway-showdown-wins', 1, 4000, 300, 'rare',
    'Last rat standing', 'podium'),
  feat('running-colours', 'Running colours', 'Win at showdown with a straight flush.', 'wins-straight-flush', 1, 15000, 1000, 'epic',
    'Colour coordinated', 'rainbow'),
  feat('four-horsemen', 'Four horsemen', 'Win at showdown with four aces.', 'wins-four-aces', 1, 10000, 700, 'epic', 'Four horsemen', 'horse-head'),
  feat('moby', 'Moby', 'Win a pot of 250 big blinds or more.', 'pots-250bb', 1, 10000, 700, 'epic', 'Moby', 'whale'),
  feat('two-birds', 'Two birds', 'Bust two players in one hand.', 'multi-knockouts', 1, 7500, 500, 'epic', 'Two birds', 'bird'),
  feat('moon-shot', 'Moon shot', 'Finish a hand with four times the chips you started it with.', 'quadruple-ups', 1, 10000, 700, 'epic',
    'Moon shot', 'moon'),
  feat('miracle-worker', 'Miracle worker', 'Win an all-in you were behind in after the turn.', 'all-in-suckouts', 1, 5000, 400, 'epic',
    'Miracle worker', 'angel-wings'),
  feat('royalty', 'Royalty', 'Win at showdown with a royal flush.', 'wins-royal-flush', 1, 25000, 1500, 'legendary', 'Royalty', 'crown'),
  feat('unstoppable', 'Unstoppable', 'Win 10 hands in a row.', 'win-streak', 10, 15000, 1000, 'legendary', 'Unstoppable', 'meteor'),
  feat('hall-of-fame', 'Hall of fame', 'Reach tier V in five career challenges.', 'tier-v-count', 5, 25000, 1500, 'legendary',
    'Hall of famer', 'laurel-trophy'),
];

/** Every achievement: career challenges in group order, then feats in catalog order. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [...CAREER_CHALLENGES, ...FEATS];

const BY_ID = new Map<string, AchievementDef>(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/** Achievements whose progress comes from a metric. */
export function achievementsForMetric(metric: MetricId): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.metric === metric);
}

/** Feats in on-screen order: rarity (common first), then catalog order. */
export function featsInDisplayOrder(): FeatDef[] {
  return FEATS.slice().sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
}

/** Highest tier reached: 1..5 for career, 1 for feats, 0 when locked. */
export function maxTier(def: AchievementDef): number {
  return def.goals.length;
}

/** Tier reached with `progress` (tier k when progress ≥ goals[k-1]; 0 = locked). */
export function tierFor(def: AchievementDef, progress: number): number {
  let tier = 0;
  for (const goal of def.goals) if (progress >= goal) tier++;
  return tier;
}

/** Stored goal for a tier (clamped to 1..max). */
export function goalFor(def: AchievementDef, tier: number): number {
  const i = Math.min(def.goals.length, Math.max(1, Math.floor(tier))) - 1;
  return def.goals[i];
}

/** A goal in display units (night owl: hours). Progress converts the same way. */
export function displayValue(def: AchievementDef, value: number): number {
  return def.kind === 'career' && def.displayDivisor ? value / def.displayDivisor : value;
}

/** Goal sentence for a tier, e.g. "Play 1,000 hands." Feats return their description. */
export function describeGoal(def: AchievementDef, tier: number): string {
  if (def.kind === 'feat') return def.description;
  const n = displayValue(def, goalFor(def, tier));
  return def.template
    .replace('{n}', formatChips(n))
    .replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_m, one: string, many: string) => (n === 1 ? one : many));
}

/** Chips and XP paid on reaching a tier. */
export function rewardFor(def: AchievementDef, tier: number): { chips: number; xp: number } {
  if (def.kind === 'feat') return { ...def.reward };
  const t = tierInfo(tier);
  return { chips: t.chips, xp: t.xp };
}

/** Emblem colours at a tier: metal for career challenges, rarity for feats. */
export function emblemColours(def: AchievementDef, tier: number): MetalColours {
  return def.kind === 'feat' ? RARITY_COLOURS[def.rarity] : tierInfo(tier).colours;
}

/** "Grinder III" for career, the name for feats. */
export function achievementLabel(def: AchievementDef, tier: number): string {
  return def.kind === 'career' && tier > 0 ? `${def.name} ${tierInfo(tier).roman}` : def.name;
}

export interface AchievementTitle {
  /** `ach:<achievementId>:<tier>` for career, `ach:<achievementId>` for feats. */
  id: string;
  text: string;
  achievementId: string;
  /** The tier that unlocks it (3 or 5 for career, 1 for feats). */
  tier: number;
}

export const ACHIEVEMENT_TITLE_PREFIX = 'ach:';

/** Titles an achievement can unlock, lowest tier first. */
export function achievementTitles(def: AchievementDef): AchievementTitle[] {
  if (def.kind === 'feat') {
    return [{ id: `${ACHIEVEMENT_TITLE_PREFIX}${def.id}`, text: def.title, achievementId: def.id, tier: 1 }];
  }
  return ([3, 5] as const).map((tier) => ({
    id: `${ACHIEVEMENT_TITLE_PREFIX}${def.id}:${tier}`, text: def.titles[tier], achievementId: def.id, tier,
  }));
}

/** The title unlocked by reaching exactly `tier`, or null. */
export function titleUnlockedAt(def: AchievementDef, tier: number): AchievementTitle | null {
  return achievementTitles(def).find((t) => t.tier === tier) ?? null;
}

const TITLE_BY_ID = new Map<string, AchievementTitle>(
  ACHIEVEMENTS.flatMap((a) => achievementTitles(a)).map((t) => [t.id, t]),
);

/** Look up an achievement title by id (`ach:...`). */
export function getAchievementTitle(id: string): AchievementTitle | undefined {
  return TITLE_BY_ID.get(id);
}

export interface UnlockedEmblem {
  id: string;
  tier: number;
  /** ISO timestamp. */
  unlockedAt: string;
}

/**
 * The automatic trophy-cabinet pick when a player hasn't chosen one: feats by
 * rarity (legendary first), then career challenges by tier (V first), ties
 * broken by the most recent unlock. Unknown ids are skipped and repeated ids
 * count once at their highest tier.
 */
export function autoShowcase(unlocked: readonly UnlockedEmblem[], n = 5): string[] {
  const best = new Map<string, UnlockedEmblem>();
  for (const u of unlocked) {
    if (!BY_ID.has(u.id) || u.tier < 1) continue;
    const prev = best.get(u.id);
    if (!prev || u.tier > prev.tier) best.set(u.id, u);
  }
  const rank = (u: UnlockedEmblem): number => {
    const def = BY_ID.get(u.id)!;
    // Feats rank above every career tier; rarity then tier order within each kind.
    return def.kind === 'feat' ? 100 + RARITY_ORDER.indexOf(def.rarity) : u.tier;
  };
  const time = (u: UnlockedEmblem): number => Date.parse(u.unlockedAt) || 0;
  return [...best.values()]
    .sort((a, b) => rank(b) - rank(a) || time(b) - time(a))
    .slice(0, n)
    .map((u) => u.id);
}
