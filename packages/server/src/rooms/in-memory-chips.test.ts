import { describe, it, expect } from 'vitest';
import { InMemoryChipService } from './in-memory-chips.js';

describe('InMemoryChipService', () => {
  it('seeds a starting balance once and reports it', () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    c.seed('a', 1); // ignored — already seeded
    expect(c.balanceOf('a')).toBe(10_000);
  });

  it('applies a deduction and returns the new balance', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    const r = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(r).toEqual({ applied: true, balance: 7000 });
    expect(c.balanceOf('a')).toBe(7000);
  });

  it('refuses a deduction that would go negative, leaving the balance untouched', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 100);
    const r = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(r).toEqual({ applied: false, balance: 100 });
    expect(c.balanceOf('a')).toBe(100);
  });

  it('is idempotent on the idempotency key', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 10_000);
    await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    const again = await c.adjust({ playerId: 'a', amount: -3000, type: 'buy-in', idempotencyKey: 'k1' });
    expect(again).toEqual({ applied: false, balance: 7000 });
    expect(c.balanceOf('a')).toBe(7000);
  });

  it('credits a cash-out back to the balance', async () => {
    const c = new InMemoryChipService();
    c.seed('a', 7000);
    const r = await c.adjust({ playerId: 'a', amount: 2975, type: 'cash-out', idempotencyKey: 'k2' });
    expect(r).toEqual({ applied: true, balance: 9975 });
  });
});
