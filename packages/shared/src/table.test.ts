import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, validateRules, type TableRules } from './table.js';

describe('validateRules', () => {
  it('accepts the defaults', () => {
    expect(validateRules({})).toEqual({ ok: true, rules: DEFAULT_RULES });
  });

  it('normalises the name', () => {
    const r = validateRules({ name: '  Friday   night ' });
    expect(r.ok && r.rules.name).toBe('Friday night');
  });

  it.each<[Partial<TableRules>, string]>([
    [{ name: '' }, 'Table name'],
    [{ smallBlind: 30, bigBlind: 50 }, 'blind levels'],
    [{ ante: 30 }, 'ante'],
    [{ minBuyIn: 100 }, 'minimum buy-in'],
    [{ maxBuyIn: 50 * 501 }, 'maximum buy-in'],
    [{ minBuyIn: 4000, maxBuyIn: 3000 }, 'at least the minimum'],
    [{ maxSeats: 10 }, 'Seats'],
    [{ turnSeconds: 12 }, 'turn timer'],
    [{ turnSeconds: 1.5 }, 'turn timer'],
  ])('rejects %o', (patch, message) => {
    const r = validateRules(patch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it('validates buy-ins against the new blinds', () => {
    // 10/20 blinds allow a 200 minimum; 25/50 would not.
    expect(validateRules({ smallBlind: 10, bigBlind: 20, minBuyIn: 200, maxBuyIn: 2000 }).ok).toBe(true);
    expect(validateRules({ minBuyIn: 200, maxBuyIn: 2000 }).ok).toBe(false);
  });
});
