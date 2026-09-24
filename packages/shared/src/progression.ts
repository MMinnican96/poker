import type { MetricId } from './metrics.js';

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export const MAX_LEVEL = 100;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 100 + 60 * (level - 1);
}

/** Total XP needed to reach `level` from zero. */
export function totalXpForLevel(level: number): number {
  // Sum of xpToNext(1..level-1) = 100(n) + 60 * n(n-1)/2 with n = level - 1.
  const n = Math.max(0, level - 1);
  return 100 * n + 30 * n * (n - 1);
}

export interface LevelProgress {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level needs in total (0 at max level). */
  needed: number;
}

export function levelFromXp(xp: number): LevelProgress {
  let level = 1;
  while (level < MAX_LEVEL && xp >= totalXpForLevel(level + 1)) level++;
  const into = xp - totalXpForLevel(level);
  return { level, into, needed: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

/** Chips credited when reaching `level`. */
export function levelUpReward(level: number): number {
  return 250 * level;
}

/** XP a single hand awards. */
export function xpForHand(fact: { result: 'won' | 'lost' | 'folded'; wentToShowdown: boolean }): number {
  let xp = 2;
  if (fact.result === 'won') xp += 6;
  if (fact.result === 'won' && fact.wentToShowdown) xp += 4;
  return xp;
}

// ---------------------------------------------------------------------------
// Daily bonus
// ---------------------------------------------------------------------------

/** Chips for claiming the daily bonus on the given streak day (1-based, caps at 7). */
export function dailyBonusAmount(streakDay: number): number {
  const day = Math.min(Math.max(streakDay, 1), 7);
  return 500 + 250 * (day - 1);
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** UTC calendar day, e.g. "2026-09-23". */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO-8601 week, e.g. "2026-W39". */
export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** When the current daily / weekly period ends (UTC). */
export function periodEndsAt(period: ChallengePeriod, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'daily') {
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const day = d.getUTCDay() || 7; // Monday = 1
  d.setUTCDate(d.getUTCDate() + (8 - day));
  return d;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export type ChallengePeriod = 'daily' | 'weekly';

/**
 * What a challenge is about. A period never shows two challenges from the same
 * family, so a day doesn't get both "Win 8 hands" and "Win 3 at showdown".
 */
export type ChallengeFamily =
  | 'volume' | 'wins' | 'aggression' | 'made-hand' | 'hole-cards' | 'big-game' | 'streak' | 'profit';

export interface ChallengeDef {
  id: string;
  period: ChallengePeriod;
  title: string;
  description: string;
  /** Progress comes from this metric (see metrics.ts); streak metrics restart each period. */
  metric: MetricId;
  goal: number;
  reward: { chips: number; xp: number };
  family: ChallengeFamily;
}

const ch = (
  id: string, period: ChallengePeriod, title: string, description: string, metric: MetricId,
  goal: number, chips: number, xp: number, family: ChallengeFamily,
): ChallengeDef => ({ id, period, title, description, metric, goal, reward: { chips, xp }, family });

export const CHALLENGES: readonly ChallengeDef[] = [
  // Daily
  ch('d-play-25', 'daily', 'Pull up a chair', 'Play 25 hands.', 'hands-played', 25, 500, 40, 'volume'),
  ch('d-play-50', 'daily', 'Settle in', 'Play 50 hands.', 'hands-played', 50, 800, 60, 'volume'),
  ch('d-win-8', 'daily', 'Rake it in', 'Win 8 hands.', 'hands-won', 8, 750, 50, 'wins'),
  ch('d-showdown-3', 'daily', 'Show me', 'Win 3 hands at showdown.', 'showdowns-won', 3, 750, 50, 'wins'),
  ch('d-steal-5', 'daily', 'Pickpocket', 'Win 5 hands without a showdown.', 'steals', 5, 600, 40, 'wins'),
  ch('d-flops-12', 'daily', 'See the flop', 'See 12 flops.', 'flops-seen', 12, 500, 40, 'volume'),
  ch('d-pfr-5', 'daily', 'Take the lead', 'Raise before the flop in 5 hands.', 'preflop-raises', 5, 600, 40, 'aggression'),
  ch('d-3bet-3', 'daily', 'Push back', 'Three-bet 3 times.', 'three-bets', 3, 700, 50, 'aggression'),
  ch('d-check-raise', 'daily', 'Gotcha', 'Check-raise once.', 'check-raises', 1, 800, 60, 'aggression'),
  ch('d-trips', 'daily', "Three's company", 'Win a hand with three of a kind or better.', 'wins-trips-plus', 1, 800, 60, 'made-hand'),
  ch('d-two-pair-3', 'daily', 'Double vision', 'Win 3 showdowns with two pair or better.', 'wins-two-pair-plus', 3, 700, 50, 'made-hand'),
  ch('d-straight', 'daily', 'Straight up', 'Win a showdown with a straight or better.', 'wins-straight-plus', 1, 800, 60, 'made-hand'),
  ch('d-flush', 'daily', 'Flush it', 'Win a showdown with a flush or better.', 'wins-flush-plus', 1, 900, 60, 'made-hand'),
  ch('d-pocket-pair-2', 'daily', 'Pocket change', 'Win 2 showdowns with a pocket pair.', 'pocket-pair-wins', 2, 700, 50, 'hole-cards'),
  ch('d-suited-3', 'daily', 'Suits you', 'Win 3 showdowns with suited hole cards.', 'suited-wins', 3, 600, 40, 'hole-cards'),
  ch('d-big-pot', 'daily', 'Big fish', 'Win a pot of 30 big blinds or more.', 'pots-30bb', 1, 800, 60, 'big-game'),
  ch('d-all-in', 'daily', 'Shove it', 'Win a hand where you went all-in.', 'all-in-wins', 1, 1000, 60, 'big-game'),
  ch('d-knockout', 'daily', 'Bouncer', 'Bust a player.', 'knockouts', 1, 1000, 70, 'big-game'),
  ch('d-streak-3', 'daily', 'Hot hand', 'Win 3 hands in a row.', 'win-streak', 3, 900, 60, 'streak'),
  ch('d-profit-20', 'daily', 'Up on the day', 'Finish the day 20 big blinds up.', 'net-bb', 20, 900, 60, 'profit'),

  // Weekly
  ch('w-play-200', 'weekly', 'Regular', 'Play 200 hands this week.', 'hands-played', 200, 4000, 300, 'volume'),
  ch('w-flops-80', 'weekly', 'Flop tourist', 'See 80 flops this week.', 'flops-seen', 80, 4000, 300, 'volume'),
  ch('w-win-50', 'weekly', 'Pot collector', 'Win 50 hands this week.', 'hands-won', 50, 5000, 350, 'wins'),
  ch('w-showdown-15', 'weekly', 'Showdown specialist', 'Win 15 hands at showdown.', 'showdowns-won', 15, 5000, 350, 'wins'),
  ch('w-steal-40', 'weekly', 'Heist week', 'Win 40 hands without a showdown.', 'steals', 40, 5000, 350, 'wins'),
  ch('w-3bet-25', 'weekly', 'Pressure cooker', 'Three-bet 25 times.', 'three-bets', 25, 5000, 350, 'aggression'),
  ch('w-boat', 'weekly', 'Full house party', 'Win 2 hands with a full house or better.', 'wins-full-house-plus', 2, 6000, 400, 'made-hand'),
  ch('w-suckout-3', 'weekly', 'Never say die', 'Win 3 showdowns you were behind in after the turn.', 'suckouts', 3, 6000, 400, 'made-hand'),
  ch('w-whale', 'weekly', 'Whale watching', 'Win a pot of 100 big blinds or more.', 'pots-100bb', 1, 6000, 400, 'big-game'),
  ch('w-knockouts-10', 'weekly', 'Closing time', 'Bust 10 players this week.', 'knockouts', 10, 6000, 400, 'big-game'),
  ch('w-streak-5', 'weekly', 'Red hot', 'Win 5 hands in a row.', 'win-streak', 5, 7000, 450, 'streak'),
  ch('w-profit', 'weekly', 'In the black', 'Finish the week 150 big blinds up.', 'net-bb', 150, 7500, 450, 'profit'),
];

/** How many challenges are active at once in each period. */
export const CHALLENGES_PER_PERIOD: Readonly<Record<ChallengePeriod, number>> = { daily: 4, weekly: 3 };

const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));
export function getChallenge(id: string): ChallengeDef | undefined {
  return CHALLENGE_BY_ID.get(id);
}

/** Small deterministic string hash → 32-bit seed. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The challenges active for a period — the same for every player. */
export function activeChallenges(period: ChallengePeriod, periodKey: string): ChallengeDef[] {
  const pool = CHALLENGES.filter((c) => c.period === period);
  const rand = rng(seedOf(`${period}:${periodKey}`));
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Walk the shuffle, skipping a challenge whose family is already picked.
  const picked: ChallengeDef[] = [];
  const families = new Set<ChallengeFamily>();
  for (const c of shuffled) {
    if (picked.length >= CHALLENGES_PER_PERIOD[period]) break;
    if (families.has(c.family)) continue;
    families.add(c.family);
    picked.push(c);
  }
  return picked;
}

export function periodKeyFor(period: ChallengePeriod, now: Date): string {
  return period === 'daily' ? dayKey(now) : weekKey(now);
}

/** A challenge as shown to a player. */
export interface ChallengeStatus {
  id: string;
  period: ChallengePeriod;
  periodKey: string;
  title: string;
  description: string;
  goal: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  reward: { chips: number; xp: number };
  endsAt: string;
}
