import { describe, expect, it } from 'vitest';
import { CATALOG, DEFAULT_LOADOUT, cosmeticsFor, emotesFor, getItem } from './shop.js';

describe('catalog', () => {
  it('has unique ids and a free default for every loadout slot', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const id of Object.values(DEFAULT_LOADOUT)) expect(getItem(id)?.price).toBe(0);
  });

  it('matches visual kinds to categories', () => {
    for (const item of CATALOG) expect(item.visual.kind).toBe(item.category);
  });

  it('gives consumables a quantity and permanents none', () => {
    for (const item of CATALOG) {
      expect(item.category === 'throwable').toBe(item.quantity !== undefined);
    }
  });

  it('derives cosmetics and emotes', () => {
    expect(cosmeticsFor({ ...DEFAULT_LOADOUT, title: 'title-shark' }).title).toBe('Card shark');
    expect(cosmeticsFor(DEFAULT_LOADOUT).title).toBeNull();
    expect(emotesFor({})).toContain('👍');
    expect(emotesFor({})).not.toContain('🐀');
    expect(emotesFor({ 'emotes-rat': 1 })).toContain('🐀');
  });
});
