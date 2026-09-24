import { randomInt } from 'node:crypto';
import { RANKS, SUITS, type Card } from '@poker/shared';

/** Returns an integer in [0, maxExclusive). Injectable so tests are deterministic. */
export type RandomInt = (maxExclusive: number) => number;

/** Cryptographically secure by default: shuffles must not be predictable. */
export const secureRandomInt: RandomInt = (max) => randomInt(max);

/** A seeded generator for tests and simulations (mulberry32). */
export function seededRandomInt(seed: number): RandomInt {
  let a = seed >>> 0;
  return (max) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle(deck: Card[], random: RandomInt = secureRandomInt): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal from the top of the deck. The deck is stored top-first so a test can
 * stack it in reading order.
 */
export function draw(deck: Card[], count: number): Card[] {
  if (count > deck.length) throw new Error('Not enough cards to deal');
  return deck.splice(0, count);
}
