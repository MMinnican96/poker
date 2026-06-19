import type { Card } from '@poker/shared';
import { rankValue } from './cards.js';

export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 0,
  pair: 1,
  'two-pair': 2,
  'three-of-a-kind': 3,
  straight: 4,
  flush: 5,
  'full-house': 6,
  'four-of-a-kind': 7,
  'straight-flush': 8,
};

const CATEGORY_NAME: Record<HandCategory, string> = {
  'high-card': 'High Card',
  pair: 'Pair',
  'two-pair': 'Two Pair',
  'three-of-a-kind': 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full House',
  'four-of-a-kind': 'Four of a Kind',
  'straight-flush': 'Straight Flush',
};

export interface HandRank {
  category: HandCategory;
  name: string;
  /** Monotonic integer: higher is strictly better; equal means a tie. */
  score: number;
  /** The best 5 cards forming this hand. */
  cards: Card[];
}

const TIEBREAK_BASE = 15; // rank values are 2..14, so base 15 is collision-free

function encodeScore(category: HandCategory, tiebreak: number[]): number {
  let score = CATEGORY_RANK[category];
  for (let i = 0; i < 5; i++) {
    score = score * TIEBREAK_BASE + (tiebreak[i] ?? 0);
  }
  return score;
}

/** Detect a straight among exactly-5 distinct-or-not values; returns high card or null. */
function straightHigh(valuesDesc: number[]): number | null {
  const distinct = Array.from(new Set(valuesDesc)).sort((a, b) => b - a);
  if (distinct.length !== 5) return null;
  if (distinct[0] - distinct[4] === 4) return distinct[0];
  // Wheel: A-2-3-4-5 (Ace plays low), straight high is 5.
  if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) return 5;
  return null;
}

/** Evaluate exactly 5 cards. */
export function evaluate5(cards: Card[]): { category: HandCategory; score: number } {
  if (cards.length !== 5) throw new Error('evaluate5 requires exactly 5 cards');

  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(values);
  const isStraight = high !== null;

  // Group rank values by frequency, ordered by (count desc, value desc).
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const shape = groups.map((g) => g[1]); // e.g. [3,2] for a full house
  const byCount = groups.map((g) => g[0]); // representative values in priority order

  if (isStraight && isFlush) {
    return { category: 'straight-flush', score: encodeScore('straight-flush', [high!]) };
  }
  if (shape[0] === 4) {
    return { category: 'four-of-a-kind', score: encodeScore('four-of-a-kind', byCount) };
  }
  if (shape[0] === 3 && shape[1] === 2) {
    return { category: 'full-house', score: encodeScore('full-house', byCount) };
  }
  if (isFlush) {
    return { category: 'flush', score: encodeScore('flush', values) };
  }
  if (isStraight) {
    return { category: 'straight', score: encodeScore('straight', [high!]) };
  }
  if (shape[0] === 3) {
    return { category: 'three-of-a-kind', score: encodeScore('three-of-a-kind', byCount) };
  }
  if (shape[0] === 2 && shape[1] === 2) {
    return { category: 'two-pair', score: encodeScore('two-pair', byCount) };
  }
  if (shape[0] === 2) {
    return { category: 'pair', score: encodeScore('pair', byCount) };
  }
  return { category: 'high-card', score: encodeScore('high-card', values) };
}

/** All k-combinations of array indices. */
function combinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = [];
  const combo: T[] = [];
  const recurse = (start: number) => {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      recurse(i + 1);
      combo.pop();
    }
  };
  recurse(0);
  return result;
}

/**
 * Evaluate the best 5-card hand from 5–7 cards (hole + community).
 */
export function evaluateBest(cards: Card[]): HandRank {
  if (cards.length < 5) throw new Error('evaluateBest requires at least 5 cards');

  let best: { category: HandCategory; score: number; cards: Card[] } | null = null;
  for (const five of combinations(cards, 5)) {
    const e = evaluate5(five);
    if (!best || e.score > best.score) best = { ...e, cards: five };
  }
  const b = best!;
  return { category: b.category, name: CATEGORY_NAME[b.category], score: b.score, cards: b.cards };
}

/** -1, 0, 1 comparison of two hands (a vs b). */
export function compareHands(a: Card[], b: Card[]): number {
  const sa = evaluateBest(a).score;
  const sb = evaluateBest(b).score;
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}
