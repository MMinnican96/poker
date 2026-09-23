import { describe, expect, it } from 'vitest';
import { parseCards } from './cards.js';
import { compareHands, describeBestHand, evaluateBest, categoryAtLeast } from './hand-eval.js';

const best = (s: string) => evaluateBest(parseCards(s));

describe('evaluateBest', () => {
  it.each([
    ['Ah Kh Qh Jh 10h 2c 3d', 'royal-flush', 'Royal flush'],
    ['9s 8s 7s 6s 5s Ad Kd', 'straight-flush', 'Straight flush, nine high'],
    ['5d 4d 3d 2d Ad Kc Qc', 'straight-flush', 'Straight flush, five high'],
    ['Qs Qh Qd Qc 2s 3h 4d', 'four-of-a-kind', 'Four queens'],
    ['Ks Kh Kd 10c 10s 2h 3d', 'full-house', 'Full house, kings full of tens'],
    ['Ah 9h 7h 4h 2h Kc Kd', 'flush', 'Flush, ace high'],
    ['9c 8d 7h 6s 5c Ad Ah', 'straight', 'Straight, nine high'],
    ['Ac 2d 3h 4s 5c Kd Qh', 'straight', 'Straight, five high'],
    ['7c 7d 7h Ks 2c 3d 9h', 'three-of-a-kind', 'Three sevens'],
    ['Ac Ad 8h 8s 2c 3d 9h', 'two-pair', 'Two pair, aces and eights'],
    ['Kc Kd 8h 7s 2c 3d 9h', 'pair', 'Pair of kings'],
    ['Ac Qd 8h 7s 2c 3d 9h', 'high-card', 'Ace high'],
  ])('%s is %s', (cards, category, label) => {
    const r = best(cards);
    expect(r.category).toBe(category);
    expect(r.label).toBe(label);
    expect(r.cards).toHaveLength(5);
  });

  it('orders categories and kickers', () => {
    expect(compareHands(parseCards('Ah Ad Kc 5s 3d'), parseCards('Ah Ad Qc 5s 3d'))).toBe(1);
    expect(compareHands(parseCards('Ah 2d 3c 4s 5d'), parseCards('2h 3d 4c 5s 6d'))).toBe(-1);
    expect(compareHands(parseCards('Ah Kh Qh Jh 9h'), parseCards('As Ks Qs Js 9s'))).toBe(0);
    // Two pair: the second pair decides before the kicker.
    expect(compareHands(parseCards('Kh Kd 9c 9s 2d'), parseCards('Kc Ks 8h 8d Ad'))).toBe(1);
    // The board plays: identical best five.
    const board = 'Ah Kh Qh Jh 10h';
    expect(compareHands(parseCards(`${board} 2c 3d`), parseCards(`${board} 4c 5d`))).toBe(0);
  });

  it('prefers the royal flush over a lower straight flush', () => {
    expect(best('Ah Kh Qh Jh 10h 9h 8h').category).toBe('royal-flush');
  });
});

describe('describeBestHand', () => {
  it('names short hands by multiplicity', () => {
    expect(describeBestHand(parseCards('Ah Ad'))?.label).toBe('Pair of aces');
    expect(describeBestHand(parseCards('Ah Kd'))?.label).toBe('Ace high');
    expect(describeBestHand(parseCards('Ah Ad Ac Kd'))?.label).toBe('Three aces');
    expect(describeBestHand(parseCards('Ah'))).toBeNull();
  });
});

describe('categoryAtLeast', () => {
  it('treats royal flush as the top', () => {
    expect(categoryAtLeast('royal-flush', 'straight-flush')).toBe(true);
    expect(categoryAtLeast('flush', 'full-house')).toBe(false);
  });
});
