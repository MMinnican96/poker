import { describe, expect, it } from 'vitest';
import {
  activeChallenges, challengeIncrement, CHALLENGES, dailyBonusAmount, dayKey, levelFromXp,
  periodEndsAt, totalXpForLevel, weekKey, xpToNext, type ChallengeFact,
} from './progression.js';

const fact = (over: Partial<ChallengeFact> = {}): ChallengeFact => ({
  result: 'won', wentToShowdown: true, finalStreet: 'showdown', handCategory: 'flush',
  potTotal: 2000, netResult: 1000, bigBlind: 50, pfr: true, wasAllIn: false, ...over,
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
  it('picks three distinct, stable challenges per period', () => {
    const a = activeChallenges('daily', '2026-09-23');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
    expect(activeChallenges('daily', '2026-09-23')).toEqual(a);
    expect(a.every((c) => c.period === 'daily')).toBe(true);
  });

  it('varies across days', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'].map((d) =>
      activeChallenges('daily', d).map((c) => c.id).join());
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('computes increments per metric', () => {
    const metric = (id: string) => CHALLENGES.find((c) => c.id === id)!.metric;
    expect(challengeIncrement(metric('d-trips'), fact())).toBe(1);
    expect(challengeIncrement(metric('d-trips'), fact({ handCategory: 'two-pair' }))).toBe(0);
    expect(challengeIncrement(metric('d-trips'), fact({ result: 'lost' }))).toBe(0);
    expect(challengeIncrement(metric('d-big-pot'), fact({ potTotal: 1500 }))).toBe(1);
    expect(challengeIncrement(metric('d-big-pot'), fact({ potTotal: 1499 }))).toBe(0);
    expect(challengeIncrement(metric('w-profit'), fact({ netResult: -500 }))).toBe(-10);
    expect(challengeIncrement(metric('d-flops-12'), fact({ finalStreet: 'pre-flop' }))).toBe(0);
    expect(challengeIncrement(metric('d-all-in'), fact({ wasAllIn: true }))).toBe(1);
  });
});

describe('daily bonus', () => {
  it('grows with the streak and caps at day 7', () => {
    expect(dailyBonusAmount(1)).toBe(500);
    expect(dailyBonusAmount(7)).toBe(2000);
    expect(dailyBonusAmount(30)).toBe(2000);
  });
});
