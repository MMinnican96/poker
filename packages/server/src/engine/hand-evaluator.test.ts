import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '@poker/shared';
import { evaluate5, evaluateBest, compareHands } from './hand-evaluator.js';

const SUIT_BY_CHAR: Record<string, Suit> = {
  h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades',
};

/** Parse compact notation like "Ah", "10d", "Kc". */
function c(str: string): Card {
  const suitChar = str.slice(-1);
  const rank = str.slice(0, -1) as Rank;
  return { rank, suit: SUIT_BY_CHAR[suitChar] };
}

const hand = (...s: string[]): Card[] => s.map(c);

describe('evaluate5 categories', () => {
  it('classifies each category correctly', () => {
    expect(evaluate5(hand('Ah', 'Kh', 'Qh', 'Jh', '10h')).category).toBe('straight-flush');
    expect(evaluate5(hand('9c', '9d', '9h', '9s', 'Kc')).category).toBe('four-of-a-kind');
    expect(evaluate5(hand('8c', '8d', '8h', 'Ks', 'Kc')).category).toBe('full-house');
    expect(evaluate5(hand('2h', '5h', '8h', 'Jh', 'Kh')).category).toBe('flush');
    expect(evaluate5(hand('5c', '6d', '7h', '8s', '9c')).category).toBe('straight');
    expect(evaluate5(hand('7c', '7d', '7h', '2s', '9c')).category).toBe('three-of-a-kind');
    expect(evaluate5(hand('4c', '4d', '9h', '9s', 'Kc')).category).toBe('two-pair');
    expect(evaluate5(hand('Jc', 'Jd', '3h', '7s', '9c')).category).toBe('pair');
    expect(evaluate5(hand('2c', '5d', '8h', 'Js', 'Kc')).category).toBe('high-card');
  });

  it('recognizes the wheel (A-2-3-4-5) as a 5-high straight', () => {
    const wheel = evaluate5(hand('Ah', '2d', '3c', '4s', '5h'));
    expect(wheel.category).toBe('straight');
    // A 6-high straight must beat the wheel.
    const sixHigh = evaluate5(hand('2h', '3d', '4c', '5s', '6h'));
    expect(sixHigh.score).toBeGreaterThan(wheel.score);
  });

  it('ranks ace-high straight above king-high straight', () => {
    const aceHigh = evaluate5(hand('10c', 'Jd', 'Qh', 'Ks', 'Ah'));
    const kingHigh = evaluate5(hand('9c', '10d', 'Jh', 'Qs', 'Kh'));
    expect(aceHigh.score).toBeGreaterThan(kingHigh.score);
  });
});

describe('category ordering', () => {
  const order = [
    hand('2c', '5d', '8h', 'Js', 'Kc'), // high card
    hand('Jc', 'Jd', '3h', '7s', '9c'), // pair
    hand('4c', '4d', '9h', '9s', 'Kc'), // two pair
    hand('7c', '7d', '7h', '2s', '9c'), // trips
    hand('5c', '6d', '7h', '8s', '9c'), // straight
    hand('2h', '5h', '8h', 'Jh', 'Kh'), // flush
    hand('8c', '8d', '8h', 'Ks', 'Kc'), // full house
    hand('9c', '9d', '9h', '9s', 'Kc'), // quads
    hand('Ah', 'Kh', 'Qh', 'Jh', '10h'), // straight flush
  ];

  it('scores strictly increase up the hand rankings', () => {
    const scores = order.map((h) => evaluate5(h).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });
});

describe('tiebreakers', () => {
  it('compares pairs by kicker', () => {
    const hi = hand('Kc', 'Kd', 'Ah', '7s', '2c');
    const lo = hand('Kh', 'Ks', 'Qh', '7d', '2d');
    expect(evaluate5(hi).score).toBeGreaterThan(evaluate5(lo).score);
  });

  it('compares flushes by highest card', () => {
    const hi = hand('Ah', '5h', '8h', 'Jh', '2h');
    const lo = hand('Kd', '5d', '8d', 'Jd', '2d');
    expect(evaluate5(hi).score).toBeGreaterThan(evaluate5(lo).score);
  });

  it('reports a tie for identical hand values across suits', () => {
    const a = hand('Ah', 'Ad', 'Kh', 'Qs', 'Jc');
    const b = hand('As', 'Ac', 'Kd', 'Qh', 'Jd');
    expect(evaluate5(a).score).toBe(evaluate5(b).score);
  });
});

describe('evaluateBest (7 cards)', () => {
  it('picks the best 5 from 7', () => {
    // hole + board makes a flush even though a pair is present
    const best = evaluateBest(hand('Ah', 'Kh', 'Qh', '2h', '7h', '7d', '2c'));
    expect(best.category).toBe('flush');
    expect(best.cards).toHaveLength(5);
  });

  it('compareHands returns 0 on equivalent best hands', () => {
    const board = ['10h', 'Jh', 'Qh', 'Kh', 'Ah'];
    const p1 = hand(...board, '2c', '3d');
    const p2 = hand(...board, '4s', '5c');
    // Both play the board's royal flush.
    expect(compareHands(p1, p2)).toBe(0);
  });
});
