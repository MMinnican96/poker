import { rankValue, type Card } from './cards.js';

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush'
  | 'royal-flush';

/** Strength order of categories (royal flush shares the straight-flush tier). */
const CATEGORY_TIER: Record<HandCategory, number> = {
  'high-card': 0, pair: 1, 'two-pair': 2, 'three-of-a-kind': 3, straight: 4,
  flush: 5, 'full-house': 6, 'four-of-a-kind': 7, 'straight-flush': 8, 'royal-flush': 8,
};

export const CATEGORY_NAME: Record<HandCategory, string> = {
  'high-card': 'High card', pair: 'Pair', 'two-pair': 'Two pair',
  'three-of-a-kind': 'Three of a kind', straight: 'Straight', flush: 'Flush',
  'full-house': 'Full house', 'four-of-a-kind': 'Four of a kind',
  'straight-flush': 'Straight flush', 'royal-flush': 'Royal flush',
};

/** Categories ordered weakest → strongest (royal last). */
export const CATEGORY_ORDER: readonly HandCategory[] = [
  'high-card', 'pair', 'two-pair', 'three-of-a-kind', 'straight', 'flush',
  'full-house', 'four-of-a-kind', 'straight-flush', 'royal-flush',
];

/** True when `a` is at least as strong a category as `b` (royal > straight flush). */
export function categoryAtLeast(a: HandCategory, b: HandCategory): boolean {
  return CATEGORY_ORDER.indexOf(a) >= CATEGORY_ORDER.indexOf(b);
}

export interface HandRank {
  category: HandCategory;
  /** Short name, e.g. "Full house". */
  name: string;
  /** Descriptive label, e.g. "Full house, kings full of tens". */
  label: string;
  /** Monotonic integer: higher is strictly better; equal means a tie. */
  score: number;
  /** The best five cards forming this hand. */
  cards: Card[];
}

const BASE = 15;

function encode(tier: number, tiebreak: number[]): number {
  let score = tier;
  for (let i = 0; i < 5; i++) score = score * BASE + (tiebreak[i] ?? 0);
  return score;
}

function straightHigh(valuesDesc: number[]): number | null {
  const distinct = [...new Set(valuesDesc)].sort((a, b) => b - a);
  if (distinct.length !== 5) return null;
  if (distinct[0] - distinct[4] === 4) return distinct[0];
  if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) return 5; // wheel
  return null;
}

interface Eval5 {
  category: HandCategory;
  score: number;
  /** Rank values that describe the hand (e.g. [trips, pair] for a full house). */
  keys: number[];
}

/** Evaluate exactly five cards. */
export function evaluate5(cards: Card[]): Eval5 {
  if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(values);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]);
  const byCount = groups.map((g) => g[0]);

  const make = (category: HandCategory, tiebreak: number[]): Eval5 => ({
    category,
    score: encode(CATEGORY_TIER[category], tiebreak),
    keys: tiebreak,
  });

  if (high !== null && flush) return make(high === 14 ? 'royal-flush' : 'straight-flush', [high]);
  if (shape[0] === 4) return make('four-of-a-kind', byCount);
  if (shape[0] === 3 && shape[1] === 2) return make('full-house', byCount);
  if (flush) return make('flush', values);
  if (high !== null) return make('straight', [high]);
  if (shape[0] === 3) return make('three-of-a-kind', byCount);
  if (shape[0] === 2 && shape[1] === 2) return make('two-pair', byCount);
  if (shape[0] === 2) return make('pair', byCount);
  return make('high-card', values);
}

const RANK_WORD: Record<number, [string, string]> = {
  2: ['two', 'twos'], 3: ['three', 'threes'], 4: ['four', 'fours'], 5: ['five', 'fives'],
  6: ['six', 'sixes'], 7: ['seven', 'sevens'], 8: ['eight', 'eights'], 9: ['nine', 'nines'],
  10: ['ten', 'tens'], 11: ['jack', 'jacks'], 12: ['queen', 'queens'], 13: ['king', 'kings'],
  14: ['ace', 'aces'],
};
const one = (v: number) => RANK_WORD[v][0];
const many = (v: number) => RANK_WORD[v][1];

function labelFor(e: Eval5): string {
  const k = e.keys;
  switch (e.category) {
    case 'royal-flush': return 'Royal flush';
    case 'straight-flush': return `Straight flush, ${one(k[0])} high`;
    case 'four-of-a-kind': return `Four ${many(k[0])}`;
    case 'full-house': return `Full house, ${many(k[0])} full of ${many(k[1])}`;
    case 'flush': return `Flush, ${one(k[0])} high`;
    case 'straight': return `Straight, ${one(k[0])} high`;
    case 'three-of-a-kind': return `Three ${many(k[0])}`;
    case 'two-pair': return `Two pair, ${many(k[0])} and ${many(k[1])}`;
    case 'pair': return `Pair of ${many(k[0])}`;
    case 'high-card': return `${capitalise(one(k[0]))} high`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const combo: T[] = [];
  const recurse = (start: number) => {
    if (combo.length === k) { out.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); recurse(i + 1); combo.pop(); }
  };
  recurse(0);
  return out;
}

/** Best five-card hand from 5–7 cards (hole + board). */
export function evaluateBest(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error('evaluateBest requires at least 5 cards');
  let best: (Eval5 & { cards: Card[] }) | null = null;
  for (const five of combinations(cards, 5)) {
    const e = evaluate5(five);
    if (!best || e.score > best.score) best = { ...e, cards: five };
  }
  const b = best!;
  return { category: b.category, name: CATEGORY_NAME[b.category], label: labelFor(b), score: b.score, cards: b.cards };
}

/** -1, 0, 1 comparison of two card sets. */
export function compareHands(a: Card[], b: Card[]): number {
  const sa = evaluateBest(a).score;
  const sb = evaluateBest(b).score;
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

/**
 * Name the best hand from 2–7 cards (display only). With fewer than five cards
 * only rank multiplicity counts — straights and flushes need five.
 */
export function describeBestHand(cards: Card[]): { name: string; label: string; category: HandCategory } | null {
  if (cards.length < 2) return null;
  if (cards.length >= 5) {
    const r = evaluateBest(cards);
    return { name: r.name, label: r.label, category: r.category };
  }
  const counts = new Map<number, number>();
  for (const c of cards) {
    const v = rankValue(c.rank);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const [top, second] = groups;
  let category: HandCategory;
  let label: string;
  if (top[1] === 4) { category = 'four-of-a-kind'; label = `Four ${many(top[0])}`; }
  else if (top[1] === 3) { category = 'three-of-a-kind'; label = `Three ${many(top[0])}`; }
  else if (top[1] === 2 && second?.[1] === 2) { category = 'two-pair'; label = `Two pair, ${many(top[0])} and ${many(second[0])}`; }
  else if (top[1] === 2) { category = 'pair'; label = `Pair of ${many(top[0])}`; }
  else { category = 'high-card'; label = `${capitalise(one(top[0]))} high`; }
  return { name: CATEGORY_NAME[category], label, category };
}
