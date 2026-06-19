import { describe, it, expect } from 'vitest';
import { collectPots, totalPot, type Contribution } from './pot.js';

const contrib = (
  playerId: string,
  contributed: number,
  folded = false,
): Contribution => ({ playerId, contributed, folded });

describe('collectPots', () => {
  it('makes a single pot when everyone contributes equally', () => {
    const pots = collectPots([contrib('a', 100), contrib('b', 100), contrib('c', 100)]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligiblePlayerIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('creates a side pot when a short stack is all-in for less', () => {
    // a all-in 50, b and c bet 200 each
    const pots = collectPots([contrib('a', 50), contrib('b', 200), contrib('c', 200)]);
    expect(pots).toHaveLength(2);
    // main pot: 50 * 3 = 150, all eligible
    expect(pots[0].amount).toBe(150);
    expect(new Set(pots[0].eligiblePlayerIds)).toEqual(new Set(['a', 'b', 'c']));
    // side pot: 150 * 2 = 300, only b and c
    expect(pots[1].amount).toBe(300);
    expect(new Set(pots[1].eligiblePlayerIds)).toEqual(new Set(['b', 'c']));
    expect(totalPot(pots)).toBe(450);
  });

  it('handles two distinct all-in levels (three pots)', () => {
    const pots = collectPots([
      contrib('a', 50),
      contrib('b', 120),
      contrib('c', 300),
      contrib('d', 300),
    ]);
    expect(totalPot(pots)).toBe(770);
    expect(pots.map((p) => p.amount)).toEqual([200, 210, 360]);
    expect(new Set(pots[0].eligiblePlayerIds)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(new Set(pots[1].eligiblePlayerIds)).toEqual(new Set(['b', 'c', 'd']));
    expect(new Set(pots[2].eligiblePlayerIds)).toEqual(new Set(['c', 'd']));
  });

  it('folded players add chips but are not eligible to win', () => {
    const pots = collectPots([contrib('a', 100, true), contrib('b', 100), contrib('c', 100)]);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligiblePlayerIds)).toEqual(new Set(['b', 'c']));
  });
});
