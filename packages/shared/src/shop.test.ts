import { describe, expect, it } from 'vitest';
import { CATALOG, DEFAULT_LOADOUT, cosmeticsFor, emotesFor, getItem, getTitle } from './shop.js';

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

  it('resolves shop and achievement titles', () => {
    expect(getTitle('title-shark')).toEqual({ id: 'title-shark', text: 'Card shark', source: 'shop' });
    expect(getTitle('title-none')).toEqual({ id: 'title-none', text: '', source: 'shop' });
    expect(getTitle('ach:grinder:3')).toEqual({
      id: 'ach:grinder:3', text: 'Regular', source: 'achievement', achievementId: 'grinder', tier: 3,
    });
    expect(getTitle('ach:royalty')).toMatchObject({ text: 'Royalty', achievementId: 'royalty', tier: 1 });
    expect(getTitle('ach:grinder:2')).toBeUndefined();
    expect(getTitle('ach:grinder')).toBeUndefined();
    expect(getTitle('felt-classic')).toBeUndefined();
    expect(getTitle('nope')).toBeUndefined();
  });

  it('shows an earned title in cosmetics', () => {
    expect(cosmeticsFor({ ...DEFAULT_LOADOUT, title: 'ach:grinder:5' }).title).toBe('Furniture');
    expect(cosmeticsFor({ ...DEFAULT_LOADOUT, title: 'ach:unknown' }).title).toBeNull();
  });
});
