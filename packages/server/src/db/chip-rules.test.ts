import { describe, it, expect } from 'vitest';
import { overdraws } from './chip-rules.js';

describe('overdraws', () => {
  it('is false for credits (positive amounts)', () => {
    expect(overdraws(0, 5000)).toBe(false);
    expect(overdraws(100, 1)).toBe(false);
  });
  it('is false for a deduction the balance can cover', () => {
    expect(overdraws(3000, -3000)).toBe(false);
    expect(overdraws(5000, -3000)).toBe(false);
  });
  it('is true for a deduction larger than the balance', () => {
    expect(overdraws(100, -3000)).toBe(true);
    expect(overdraws(0, -1)).toBe(true);
  });
});
