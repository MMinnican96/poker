import type { Card } from '@poker/shared';
import { RANKS, SUITS } from './cards.js';

/** Random source in [0, 1). Injectable so tests can be deterministic. */
export type Rng = () => number;

/** A fresh, ordered 52-card deck. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Return a shuffled copy using the Fisher-Yates algorithm. Does not mutate the
 * input. `rng` defaults to Math.random but can be injected for determinism.
 */
export function shuffle(deck: Card[], rng: Rng = Math.random): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled fresh deck. */
export function freshShuffledDeck(rng: Rng = Math.random): Card[] {
  return shuffle(createDeck(), rng);
}

/**
 * Deal `count` cards from the top (end) of the deck. Mutates `deck` (pops) and
 * returns the dealt cards — mirrors dealing off a physical deck.
 */
export function deal(deck: Card[], count: number): Card[] {
  if (count > deck.length) throw new Error('Not enough cards to deal');
  const dealt: Card[] = [];
  for (let i = 0; i < count; i++) {
    dealt.push(deck.pop()!);
  }
  return dealt;
}
