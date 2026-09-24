import { describe, expect, it } from 'vitest';
import { isMetricId, metricValue, type HandFact } from './metrics.js';
import {
  activeChallenges, CHALLENGES, CHALLENGES_PER_PERIOD, dailyBonusAmount, dayKey, getChallenge, levelFromXp,
  periodEndsAt, totalXpForLevel, weekKey, xpToNext, type ChallengePeriod,
} from './progression.js';

const fact = (over: Partial<HandFact> = {}): HandFact => ({
  tableId: 't', playerId: 'p', handNumber: 1, seat: 0, position: 0, bigBlind: 50,
  chipsContributed: 500, chipsWon: 1500, netResult: 1000, result: 'won', handCategory: 'flush',
  potTotal: 2000, wentToShowdown: true, vpip: true, pfr: true, aggressiveActions: 1,
  passiveActions: 0, wasAllIn: false, finalStreet: 'showdown', durationMs: 30_000, ...over,
});

describe('levels', () => {
  it('starts at level 1 and crosses thresholds exactly', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, needed: 100 });
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100)).toEqual({ level: 2, into: 0, needed: 160 });
    expect(levelFromXp(totalXpForLevel(10)).level).toBe(10);
    expect(totalXpForLevel(3)).toBe(xpToNext(1) + xpToNext(2));
  });

  it('caps at level 100', () => {
    expect(levelFromXp(10_000_000)).toMatchObject({ level: 100, needed: 0 });
  });
});

describe('periods', () => {
  it('formats day and ISO week keys', () => {
    const d = new Date('2026-09-23T15:00:00Z');
    expect(dayKey(d)).toBe('2026-09-23');
    expect(weekKey(d)).toBe('2026-W39');
    expect(weekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });

  it('computes period ends', () => {
    const wed = new Date('2026-09-23T15:00:00Z');
    expect(periodEndsAt('daily', wed).toISOString()).toBe('2026-09-24T00:00:00.000Z');
    expect(periodEndsAt('weekly', wed).toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('challenges', () => {
  const days = Array.from({ length: 60 }, (_, i) => dayKey(new Date(Date.UTC(2026, 8, 1 + i))));
  const weeks = Array.from({ length: 30 }, (_, i) => weekKey(new Date(Date.UTC(2026, 0, 1 + 7 * i))));

  it('has a pool of 20 daily and 12 weekly challenges with unique ids and known metrics', () => {
    expect(CHALLENGES.filter((c) => c.period === 'daily')).toHaveLength(20);
    expect(CHALLENGES.filter((c) => c.period === 'weekly')).toHaveLength(12);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    for (const c of CHALLENGES) {
      expect(isMetricId(c.metric)).toBe(true);
      expect(c.goal).toBeGreaterThan(0);
      expect(c.family).toBeTruthy();
    }
  });

  it('keeps the existing challenges as they were', () => {
    expect(getChallenge('d-trips')).toMatchObject({ metric: 'wins-trips-plus', goal: 1, reward: { chips: 800, xp: 60 } });
    expect(getChallenge('w-profit')).toMatchObject({ metric: 'net-bb', goal: 150, reward: { chips: 7500, xp: 450 } });
    expect(getChallenge('d-big-pot')).toMatchObject({ metric: 'pots-30bb', title: 'Big fish' });
  });

  it('picks 4 daily and 3 weekly challenges with distinct families', () => {
    expect(CHALLENGES_PER_PERIOD).toEqual({ daily: 4, weekly: 3 });
    const check = (period: ChallengePeriod, key: string) => {
      const a = activeChallenges(period, key);
      expect(a).toHaveLength(CHALLENGES_PER_PERIOD[period]);
      expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
      expect(new Set(a.map((c) => c.family)).size).toBe(a.length);
      expect(a.every((c) => c.period === period)).toBe(true);
    };
    for (const d of days) check('daily', d);
    for (const w of weeks) check('weekly', w);
  });

  it('is deterministic for a period', () => {
    expect(activeChallenges('daily', '2026-09-23')).toEqual(activeChallenges('daily', '2026-09-23'));
    expect(activeChallenges('weekly', '2026-W39')).toEqual(activeChallenges('weekly', '2026-W39'));
  });

  it('varies across days', () => {
    const picks = days.slice(0, 7).map((d) => activeChallenges('daily', d).map((c) => c.id).join());
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it('measures progress with the metric registry', () => {
    const inc = (id: string, over: Partial<HandFact> = {}) => metricValue(getChallenge(id)!.metric, fact(over));
    expect(inc('d-trips', { handCategory: 'three-of-a-kind' })).toBe(1);
    expect(inc('d-trips', { handCategory: 'two-pair' })).toBe(0);
    expect(inc('d-trips', { handCategory: 'full-house', result: 'lost' })).toBe(0);
    expect(inc('d-big-pot', { potTotal: 1500 })).toBe(1);
    expect(inc('d-big-pot', { potTotal: 1499 })).toBe(0);
    expect(inc('w-profit', { netResult: -500 })).toBe(-10);
    expect(inc('d-flops-12', { finalStreet: 'pre-flop' })).toBe(0);
    expect(inc('d-all-in', { wasAllIn: true })).toBe(1);
  });
});

describe('daily bonus', () => {
  it('grows with the streak and caps at day 7', () => {
    expect(dailyBonusAmount(1)).toBe(500);
    expect(dailyBonusAmount(7)).toBe(2000);
    expect(dailyBonusAmount(30)).toBe(2000);
  });
});
