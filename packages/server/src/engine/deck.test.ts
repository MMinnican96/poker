import { describe, it, expect } from 'vitest';
import { createDeck, shuffle, deal, freshShuffledDeck } from './deck.js';
import { cardToString } from './cards.js';

describe('deck', () => {
  it('createDeck returns 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck.map(cardToString));
    expect(unique.size).toBe(52);
  });

  it('shuffle preserves the exact multiset of cards', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardToString))).toEqual(new Set(deck.map(cardToString)));
  });

  it('shuffle does not mutate the input', () => {
    const deck = createDeck();
    const before = deck.map(cardToString).join(',');
    shuffle(deck);
    expect(deck.map(cardToString).join(',')).toBe(before);
  });

  it('shuffle is deterministic with an injected rng', () => {
    const seq = [0.1, 0.9, 0.4, 0.7, 0.2];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    i = 0;
    const a = shuffle(createDeck(), rng).map(cardToString);
    i = 0;
    const b = shuffle(createDeck(), rng).map(cardToString);
    expect(a).toEqual(b);
  });

  it('deal pops cards off the top and shrinks the deck', () => {
    const deck = freshShuffledDeck(() => 0.5);
    const before = deck.length;
    const hand = deal(deck, 2);
    expect(hand).toHaveLength(2);
    expect(deck).toHaveLength(before - 2);
  });

  it('deal throws when asking for more cards than remain', () => {
    const deck = createDeck();
    expect(() => deal(deck, 53)).toThrow();
  });
});
