import type { HandCategory } from './hand-eval.js';

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

/** The subset of a hand fact challenges look at. */
export interface ChallengeFact {
  result: 'won' | 'lost' | 'folded';
  wentToShowdown: boolean;
  finalStreet: string;
  handCategory: HandCategory | null;
  potTotal: number;
  netResult: number;
  bigBlind: number;
  pfr: boolean;
  wasAllIn: boolean;
}

export type ChallengeMetric =
  | { kind: 'hands-played' }
  | { kind: 'hands-won' }
  | { kind: 'showdowns-won' }
  | { kind: 'flops-seen' }
  | { kind: 'preflop-raises' }
  | { kind: 'all-in-wins' }
  | { kind: 'win-with'; atLeast: HandCategory }
  | { kind: 'pot-won'; bigBlinds: number }
  | { kind: 'net-big-blinds' };

export interface ChallengeDef {
  id: string;
  period: ChallengePeriod;
  title: string;
  description: string;
  metric: ChallengeMetric;
  goal: number;
  reward: { chips: number; xp: number };
}

const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0, pair: 1, 'two-pair': 2, 'three-of-a-kind': 3, straight: 4, flush: 5,
  'full-house': 6, 'four-of-a-kind': 7, 'straight-flush': 8, 'royal-flush': 9,
};

/** How much one hand moves a challenge's progress. */
export function challengeIncrement(metric: ChallengeMetric, f: ChallengeFact): number {
  const won = f.result === 'won';
  switch (metric.kind) {
    case 'hands-played': return 1;
    case 'hands-won': return won ? 1 : 0;
    case 'showdowns-won': return won && f.wentToShowdown ? 1 : 0;
    case 'flops-seen': return f.finalStreet !== 'pre-flop' ? 1 : 0;
    case 'preflop-raises': return f.pfr ? 1 : 0;
    case 'all-in-wins': return won && f.wasAllIn ? 1 : 0;
    case 'win-with':
      return won && f.handCategory && CATEGORY_RANK[f.handCategory] >= CATEGORY_RANK[metric.atLeast] ? 1 : 0;
    case 'pot-won':
      return won && f.bigBlind > 0 && f.potTotal >= metric.bigBlinds * f.bigBlind ? 1 : 0;
    case 'net-big-blinds':
      return f.bigBlind > 0 ? f.netResult / f.bigBlind : 0;
  }
}

export const CHALLENGES: readonly ChallengeDef[] = [
  // Daily
  { id: 'd-play-25', period: 'daily', title: 'Pull up a chair', description: 'Play 25 hands.',
    metric: { kind: 'hands-played' }, goal: 25, reward: { chips: 500, xp: 40 } },
  { id: 'd-win-8', period: 'daily', title: 'Rake it in', description: 'Win 8 hands.',
    metric: { kind: 'hands-won' }, goal: 8, reward: { chips: 750, xp: 50 } },
  { id: 'd-showdown-3', period: 'daily', title: 'Show me', description: 'Win 3 hands at showdown.',
    metric: { kind: 'showdowns-won' }, goal: 3, reward: { chips: 750, xp: 50 } },
  { id: 'd-flops-12', period: 'daily', title: 'See the flop', description: 'See 12 flops.',
    metric: { kind: 'flops-seen' }, goal: 12, reward: { chips: 500, xp: 40 } },
  { id: 'd-pfr-5', period: 'daily', title: 'Take the lead', description: 'Raise before the flop in 5 hands.',
    metric: { kind: 'preflop-raises' }, goal: 5, reward: { chips: 600, xp: 40 } },
  { id: 'd-trips', period: 'daily', title: "Three's company", description: 'Win a hand with three of a kind or better.',
    metric: { kind: 'win-with', atLeast: 'three-of-a-kind' }, goal: 1, reward: { chips: 800, xp: 60 } },
  { id: 'd-big-pot', period: 'daily', title: 'Big fish', description: 'Win a pot of 30 big blinds or more.',
    metric: { kind: 'pot-won', bigBlinds: 30 }, goal: 1, reward: { chips: 800, xp: 60 } },
  { id: 'd-all-in', period: 'daily', title: 'Shove it', description: 'Win a hand where you went all-in.',
    metric: { kind: 'all-in-wins' }, goal: 1, reward: { chips: 1000, xp: 60 } },

  // Weekly
  { id: 'w-play-200', period: 'weekly', title: 'Regular', description: 'Play 200 hands this week.',
    metric: { kind: 'hands-played' }, goal: 200, reward: { chips: 4000, xp: 300 } },
  { id: 'w-win-50', period: 'weekly', title: 'Pot collector', description: 'Win 50 hands this week.',
    metric: { kind: 'hands-won' }, goal: 50, reward: { chips: 5000, xp: 350 } },
  { id: 'w-showdown-15', period: 'weekly', title: 'Showdown specialist', description: 'Win 15 hands at showdown.',
    metric: { kind: 'showdowns-won' }, goal: 15, reward: { chips: 5000, xp: 350 } },
  { id: 'w-boat', period: 'weekly', title: 'Full house party', description: 'Win 2 hands with a full house or better.',
    metric: { kind: 'win-with', atLeast: 'full-house' }, goal: 2, reward: { chips: 6000, xp: 400 } },
  { id: 'w-profit', period: 'weekly', title: 'In the black', description: 'Finish the week 150 big blinds up.',
    metric: { kind: 'net-big-blinds' }, goal: 150, reward: { chips: 7500, xp: 450 } },
  { id: 'w-whale', period: 'weekly', title: 'Whale watching', description: 'Win a pot of 100 big blinds or more.',
    metric: { kind: 'pot-won', bigBlinds: 100 }, goal: 1, reward: { chips: 6000, xp: 400 } },
];

export const CHALLENGES_PER_PERIOD = 3;

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
  return shuffled.slice(0, CHALLENGES_PER_PERIOD);
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
