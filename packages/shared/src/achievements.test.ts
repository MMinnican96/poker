import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, CAREER_CHALLENGES, CAREER_GROUPS, FEATS, RARITY_COLOURS, TIER_INFO,
  achievementLabel, achievementTitles, autoShowcase, describeGoal, displayValue, emblemColours,
  featsInDisplayOrder, getAchievement, getAchievementTitle, goalFor, rewardFor, tierFor, titleUnlockedAt,
  type AchievementDef,
} from './achievements.js';
import { isMetricId } from './metrics.js';
import { CATALOG, permanentPaidItemCount } from './shop.js';

const get = (id: string): AchievementDef => getAchievement(id)!;
const HEX = /^#[0-9a-f]{6}$/i;

describe('catalog', () => {
  it('has 26 career challenges and 19 feats with unique ids', () => {
    expect(CAREER_CHALLENGES).toHaveLength(26);
    expect(FEATS).toHaveLength(19);
    expect(ACHIEVEMENTS).toHaveLength(45);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(45);
    for (const a of ACHIEVEMENTS) expect(getAchievement(a.id)).toBe(a);
    expect(getAchievement('nope')).toBeUndefined();
  });

  it('gives career challenges five strictly ascending goals and feats one', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.goals).toHaveLength(a.kind === 'career' ? 5 : 1);
      for (let i = 1; i < a.goals.length; i++) expect(a.goals[i]).toBeGreaterThan(a.goals[i - 1]);
      expect(a.goals[0]).toBeGreaterThan(0);
    }
  });

  it('uses only known metrics and groups, and one glyph per achievement', () => {
    const groups = new Set(CAREER_GROUPS.map((g) => g.id));
    for (const a of ACHIEVEMENTS) {
      expect(isMetricId(a.metric)).toBe(true);
      if (a.kind === 'career') expect(groups.has(a.group)).toBe(true);
      expect(a.glyph).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
    expect(new Set(ACHIEVEMENTS.map((a) => a.glyph)).size).toBe(45);
  });

  it('lists career challenges in group order', () => {
    const order = CAREER_GROUPS.map((g) => g.id);
    const seen = CAREER_CHALLENGES.map((c) => order.indexOf(c.group));
    expect(seen).toEqual(seen.slice().sort((a, b) => a - b));
    for (const g of CAREER_GROUPS) expect(CAREER_CHALLENGES.some((c) => c.group === g.id)).toBe(true);
  });

  it('gives secret feats a hint and the rest none', () => {
    const secret = FEATS.filter((f) => f.secret).map((f) => f.id);
    expect(secret).toEqual(['the-rock', 'the-hammer', 'cracked']);
    for (const f of FEATS) expect(!!f.hint).toBe(f.secret);
  });

  it('never asks the collector to own more than the shop sells', () => {
    const collector = get('collector');
    expect(collector.goals[4]).toBeLessThanOrEqual(permanentPaidItemCount());
    expect(permanentPaidItemCount()).toBe(CATALOG.filter((i) => i.quantity === undefined && i.price > 0).length);
  });

  it('defines tier metals and rarity colours as hex', () => {
    expect([1, 2, 3, 4, 5].map((t) => TIER_INFO[t as 1].name)).toEqual(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']);
    expect([1, 2, 3, 4, 5].map((t) => TIER_INFO[t as 1].roman)).toEqual(['I', 'II', 'III', 'IV', 'V']);
    for (const c of [...Object.values(TIER_INFO).map((t) => t.colours), ...Object.values(RARITY_COLOURS)]) {
      expect(c.light).toMatch(HEX);
      expect(c.base).toMatch(HEX);
      expect(c.dark).toMatch(HEX);
    }
    expect(emblemColours(get('grinder'), 3)).toBe(TIER_INFO[3].colours);
    expect(emblemColours(get('royalty'), 1)).toBe(RARITY_COLOURS.legendary);
  });

  it('orders feats by rarity, then catalog order', () => {
    const ids = featsInDisplayOrder().map((f) => f.id);
    expect(ids.slice(0, 3)).toEqual(['fresh-cheese', 'fair-share', 'the-rock']);
    expect(ids.slice(-3)).toEqual(['royalty', 'unstoppable', 'hall-of-fame']);
  });
});

describe('tiers and goals', () => {
  it('computes the tier reached', () => {
    const g = get('grinder');
    expect(tierFor(g, 0)).toBe(0);
    expect(tierFor(g, 49)).toBe(0);
    expect(tierFor(g, 50)).toBe(1);
    expect(tierFor(g, 999.5)).toBe(2);
    expect(tierFor(g, 1000)).toBe(3);
    expect(tierFor(g, 1_000_000)).toBe(5);
    expect(tierFor(get('on-a-heater'), 4)).toBe(0);
    expect(tierFor(get('on-a-heater'), 5)).toBe(1);
  });

  it('describes goals with formatted numbers and plurals', () => {
    expect(describeGoal(get('grinder'), 3)).toBe('Play 1,000 hands.');
    expect(describeGoal(get('grinder'), 5)).toBe('Play 20,000 hands.');
    expect(describeGoal(get('big-fish'), 1)).toBe('Win 1 pot of 50 big blinds or more.');
    expect(describeGoal(get('big-fish'), 2)).toBe('Win 10 pots of 50 big blinds or more.');
    expect(describeGoal(get('trapper'), 1)).toBe('Check-raise 1 time.');
    expect(describeGoal(get('made-rat'), 4)).toBe('Reach level 50.');
    expect(describeGoal(get('royalty'), 1)).toBe('Win at showdown with a royal flush.');
  });

  it('shows night owl goals in hours', () => {
    const owl = get('night-owl');
    expect([1, 2, 3, 4, 5].map((t) => describeGoal(owl, t))).toEqual([
      'Spend 1 hour in hands.', 'Spend 5 hours in hands.', 'Spend 25 hours in hands.',
      'Spend 100 hours in hands.', 'Spend 500 hours in hands.',
    ]);
    expect(displayValue(owl, 90)).toBe(1.5);
    expect(displayValue(get('grinder'), 90)).toBe(90);
    expect(goalFor(owl, 1)).toBe(60);
    expect(goalFor(owl, 9)).toBe(30000);
  });

  it('never leaves template markers in a goal sentence', () => {
    for (const a of ACHIEVEMENTS) {
      for (let t = 1; t <= a.goals.length; t++) expect(describeGoal(a, t)).not.toMatch(/[{}[\]|]/);
    }
  });

  it('pays the tier reward for career and the fixed reward for feats', () => {
    expect(rewardFor(get('grinder'), 1)).toEqual({ chips: 500, xp: 50 });
    expect(rewardFor(get('grinder'), 3)).toEqual({ chips: 2500, xp: 200 });
    expect(rewardFor(get('collector'), 5)).toEqual({ chips: 10000, xp: 600 });
    expect(rewardFor(get('royalty'), 1)).toEqual({ chips: 25000, xp: 1500 });
    expect(rewardFor(get('fresh-cheese'), 1)).toEqual({ chips: 250, xp: 25 });
  });

  it('labels a career tier with its numeral', () => {
    expect(achievementLabel(get('grinder'), 3)).toBe('Grinder III');
    expect(achievementLabel(get('royalty'), 1)).toBe('Royalty');
  });
});

describe('titles', () => {
  it('gives career challenges titles at tiers III and V and feats one', () => {
    expect(achievementTitles(get('grinder'))).toEqual([
      { id: 'ach:grinder:3', text: 'Regular', achievementId: 'grinder', tier: 3 },
      { id: 'ach:grinder:5', text: 'Furniture', achievementId: 'grinder', tier: 5 },
    ]);
    expect(achievementTitles(get('royalty'))).toEqual([
      { id: 'ach:royalty', text: 'Royalty', achievementId: 'royalty', tier: 1 },
    ]);
    expect(titleUnlockedAt(get('grinder'), 2)).toBeNull();
    expect(titleUnlockedAt(get('grinder'), 3)?.id).toBe('ach:grinder:3');
    expect(titleUnlockedAt(get('grinder'), 5)?.text).toBe('Furniture');
    expect(titleUnlockedAt(get('cracked'), 1)?.text).toBe('Aces cracked');
    expect(getAchievementTitle('ach:flusher:3')?.text).toBe('Flush with cash');
    expect(getAchievementTitle('ach:flusher:4')).toBeUndefined();
  });

  it('has unique, non-empty title ids and texts that differ from shop titles', () => {
    const titles = ACHIEVEMENTS.flatMap((a) => achievementTitles(a));
    expect(titles).toHaveLength(26 * 2 + 19);
    expect(new Set(titles.map((t) => t.id)).size).toBe(titles.length);
    expect(new Set(titles.map((t) => t.text)).size).toBe(titles.length);
    const shopTexts = new Set(CATALOG.flatMap((i) => (i.visual.kind === 'title' ? [i.visual.text] : [])));
    for (const t of titles) {
      expect(t.text.trim()).not.toBe('');
      expect(shopTexts.has(t.text)).toBe(false);
    }
  });
});

describe('autoShowcase', () => {
  const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;

  it('ranks feats by rarity, then career by tier, then most recent', () => {
    const picked = autoShowcase([
      { id: 'grinder', tier: 5, unlockedAt: at(1) },
      { id: 'fresh-cheese', tier: 1, unlockedAt: at(2) },
      { id: 'royalty', tier: 1, unlockedAt: at(3) },
      { id: 'pot-taker', tier: 2, unlockedAt: at(4) },
      { id: 'flusher', tier: 2, unlockedAt: at(5) },
      { id: 'moby', tier: 1, unlockedAt: at(6) },
      { id: 'shover', tier: 1, unlockedAt: at(7) },
    ]);
    expect(picked).toEqual(['royalty', 'moby', 'fresh-cheese', 'grinder', 'flusher']);
  });

  it('counts an id once at its highest tier, skips unknown ids and honours n', () => {
    const picked = autoShowcase([
      { id: 'grinder', tier: 1, unlockedAt: at(9) },
      { id: 'grinder', tier: 3, unlockedAt: at(2) },
      { id: 'pot-taker', tier: 2, unlockedAt: at(8) },
      { id: 'gone', tier: 5, unlockedAt: at(1) },
    ], 2);
    expect(picked).toEqual(['grinder', 'pot-taker']);
    expect(autoShowcase([])).toEqual([]);
  });
});
