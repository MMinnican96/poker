import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ACHIEVEMENTS,
  CAREER_CHALLENGES,
  achievementTitles,
  activeChallenges,
  dayKey,
  getAchievement,
  periodKeyFor,
  rewardFor,
  totalXpForLevel,
  type HandFact,
} from '@poker/shared';
import { chipTransactions, playerAchievements, playerChallenges, players } from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { fact as baseFact } from './stats-aggregate.test.js';
import { createServices } from './index.js';
import { foldFacts, recordEvent, settle, unlockActivityText, unlockNotice } from './achievements.js';
import type { HandHistoryRecord } from './hand-facts.js';

const t = useTestDb();
const NOW = new Date('2026-09-24T12:00:00Z');
const svc = () => createServices(t.db, () => NOW);

function fact(tableId: string, playerId: string, handNumber: number, over: Partial<HandFact> = {}): HandFact {
  return { ...baseFact({ tableId, playerId, handNumber }), ...over };
}
const WON: Partial<HandFact> = { result: 'won', chipsWon: 100, netResult: 50, chipsContributed: 50 };

function history(tableId: string, handNumber: number, ids: string[]): HandHistoryRecord {
  return {
    tableId, handNumber, board: [], pots: [{ amount: 100, winnerIds: [ids[0]], handLabel: null }],
    players: ids.map((id, i) => ({
      id, seat: i, cards: [{ rank: '9', suit: 'clubs' }, { rank: '4', suit: 'diamonds' }],
      shown: false, net: 0, handLabel: null, result: 'lost',
    })),
  };
}

async function ledger(playerId: string, key: string) {
  return t.db.select().from(chipTransactions)
    .where(and(eq(chipTransactions.playerId, playerId), eq(chipTransactions.idempotencyKey, key)));
}

async function row(playerId: string, achievementId: string) {
  const [r] = await t.db.select().from(playerAchievements)
    .where(and(eq(playerAchievements.playerId, playerId), eq(playerAchievements.achievementId, achievementId)));
  return r;
}

describe('recording hands', () => {
  it('pays an unlock once, even when the hand is recorded again', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const table = randomUUID();
    const facts = [fact(table, a, 1, WON)];
    const first = await s.recorder.recordHand(facts, history(table, 1, [a]));
    expect(first.unlocks).toEqual([{ playerId: a, achievementId: 'fresh-cheese', tier: 1, chips: 250, xp: 25, titleId: 'ach:fresh-cheese' }]);
    const again = await s.recorder.recordHand(facts, history(table, 1, [a]));
    expect(again.unlocks).toEqual([]);
    expect(await ledger(a, `achievement:${a}:fresh-cheese:1`)).toHaveLength(1);
    expect(await s.bank.balance(a)).toBe(10_000 + 250);
    expect(await row(a, 'grinder')).toMatchObject({ progress: 1, tier: 0 });
  });

  it('pays once when two tables record a first win at the same time', async () => {
    const s = svc();
    for (let round = 0; round < 3; round++) {
      const a = await makePlayer(t.db);
      const tables = [randomUUID(), randomUUID(), randomUUID()];
      const outcomes = await Promise.all(tables.map((tid) => s.recorder.recordHand([fact(tid, a, 1, WON)], history(tid, 1, [a]))));
      expect(outcomes.flatMap((o) => o.unlocks).filter((u) => u.achievementId === 'fresh-cheese')).toHaveLength(1);
      expect(await ledger(a, `achievement:${a}:fresh-cheese:1`)).toHaveLength(1);
      expect(await row(a, 'pot-taker')).toMatchObject({ progress: 3 });
    }
  });

  it('resets a streak on a miss and keeps the best', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const table = randomUUID();
    let hand = 0;
    const play = async (won: boolean) => {
      hand += 1;
      return s.recorder.recordHand([fact(table, a, hand, won ? WON : { result: 'lost', netResult: -50 })], history(table, hand, [a]));
    };
    for (let i = 0; i < 4; i++) await play(true);
    await play(false);
    expect(await row(a, 'on-a-heater')).toMatchObject({ progress: 4, current: 0, tier: 0 });
    for (let i = 0; i < 4; i++) await play(true);
    expect(await row(a, 'on-a-heater')).toMatchObject({ progress: 4, current: 4, tier: 0 });
    const out = await play(true);
    expect(out.unlocks.map((u) => u.achievementId)).toContain('on-a-heater');
    expect(await row(a, 'on-a-heater')).toMatchObject({ progress: 5, current: 5, tier: 1 });
  });

  it('keeps streak challenges per period in the challenge row', async () => {
    const a = await makePlayer(t.db);
    const table = randomUUID();
    // Find a day whose daily pick includes the win-streak challenge.
    let day = new Date(NOW);
    while (!activeChallenges('daily', periodKeyFor('daily', day)).some((c) => c.metric === 'win-streak')) {
      day = new Date(day.getTime() + 86_400_000);
    }
    const s2 = createServices(t.db, () => day);
    const key = periodKeyFor('daily', day);
    const results = [true, true, false, true, true, true];
    for (const [i, won] of results.entries()) {
      await s2.recorder.recordHand([fact(table, a, i + 1, won ? WON : { result: 'folded' })], history(table, i + 1, [a]));
    }
    const [c] = await t.db.select().from(playerChallenges)
      .where(and(eq(playerChallenges.playerId, a), eq(playerChallenges.periodKey, key), eq(playerChallenges.challengeId, 'd-streak-3')));
    expect(c).toMatchObject({ progress: 3, current: 3 });
    expect(c.completedAt).not.toBeNull();
  });

  it('pays several tiers at once, and feeds tier V into the hall of fame', async () => {
    const a = await makePlayer(t.db);
    // Five career challenges already at their tier V goal, but unpaid.
    const five = CAREER_CHALLENGES.filter((d) => d.metric !== 'level').slice(0, 5);
    await t.db.insert(playerAchievements).values(five.map((d) => ({ playerId: a, achievementId: d.id, progress: d.goals[4] })));
    const settled = await t.db.transaction((tx) => settle(tx, a));
    for (const d of five) {
      expect(settled.unlocks.filter((u) => u.achievementId === d.id).map((u) => u.tier)).toEqual([1, 2, 3, 4, 5]);
    }
    expect(settled.unlocks.some((u) => u.achievementId === 'hall-of-fame')).toBe(true);
    // The XP pushed the player up levels, which the `level` metric picked up.
    expect(settled.levelUps.length).toBeGreaterThan(0);
    expect(settled.unlocks.some((u) => u.achievementId === 'made-rat')).toBe(true);
    const again = await t.db.transaction((tx) => settle(tx, a));
    expect(again.unlocks).toEqual([]);
    const titled = settled.unlocks.filter((u) => u.titleId).map((u) => u.titleId);
    expect(titled).toContain(`ach:${five[0].id}:3`);
    expect(titled).toContain(`ach:${five[0].id}:5`);
  });
});

describe('event metrics', () => {
  it('counts the daily-bonus streak', async () => {
    let now = new Date('2026-09-20T10:00:00Z');
    const s = createServices(t.db, () => now);
    const a = await makePlayer(t.db);
    const got = [];
    for (let day = 0; day < 3; day++) {
      const r = await s.rewards.claimDaily(a);
      expect(r.ok).toBe(true);
      if (r.ok) got.push(...r.unlocks);
      now = new Date(now.getTime() + 86_400_000);
    }
    expect(got.map((u) => [u.achievementId, u.tier])).toEqual([['clockwork', 1]]);
    expect(await s.bank.balance(a)).toBe(10_000 + 500 + 750 + 1000 + 500);
  });

  it('counts claimed challenges and passes on level-ups', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const key = periodKeyFor('daily', NOW);
    const def = activeChallenges('daily', key)[0];
    await t.db.insert(playerChallenges).values({ playerId: a, periodKey: key, challengeId: def.id, progress: def.goal, completedAt: NOW });
    await t.db.insert(playerAchievements).values({ playerId: a, achievementId: 'contractor', progress: 4 });
    // One XP short of level 5, so the claim's XP levels up into Made rat I.
    await t.db.update(players).set({ xp: totalXpForLevel(5) - 1 }).where(eq(players.discordUserId, a));
    const r = await s.rewards.claimChallenge(a, key, def.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unlocks.map((u) => [u.achievementId, u.tier]).sort()).toEqual([['contractor', 1], ['made-rat', 1]]);
    expect(r.levelUps.map((l) => l.level)).toContain(5);
    expect(r.balance).toBe(await s.bank.balance(a));
  });

  it('counts permanent shop items owned', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const first = await s.shop.purchase(a, 'felt-oxblood', randomUUID());
    expect(first).toMatchObject({ ok: true, unlocks: [] });
    const tomato = await s.shop.purchase(a, 'throw-tomato', randomUUID()); // consumables don't count
    expect(tomato).toMatchObject({ ok: true, unlocks: [] });
    const second = await s.shop.purchase(a, 'back-navy', randomUUID());
    expect(second).toMatchObject({ ok: true, unlocks: [{ achievementId: 'collector', tier: 1, chips: 500 }] });
    if (second.ok) expect(second.balance).toBe(await s.bank.balance(a));
  });

  it('returns the level-ups an unlock pays from a purchase or a daily bonus', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.shop.purchase(a, 'felt-oxblood', randomUUID());
    await t.db.update(players).set({ xp: totalXpForLevel(3) - 1 }).where(eq(players.discordUserId, a));
    const bought = await s.shop.purchase(a, 'back-navy', randomUUID()); // Collector I's XP levels up
    expect(bought).toMatchObject({ ok: true, levelUps: [{ playerId: a, level: 3, reward: 750 }] });
    if (bought.ok) expect(bought.balance).toBe(await s.bank.balance(a));

    const b = await makePlayer(t.db);
    await t.db.update(players).set({ dailyStreak: 2, lastDailyClaim: dayKey(new Date(NOW.getTime() - 86_400_000)), xp: totalXpForLevel(3) - 1 })
      .where(eq(players.discordUserId, b));
    const daily = await s.rewards.claimDaily(b); // Clockwork I's XP levels up
    expect(daily).toMatchObject({ ok: true, streak: 3, levelUps: [{ playerId: b, level: 3, reward: 750 }] });
    if (daily.ok) expect(daily.balance).toBe(await s.bank.balance(b));
    expect(await s.rewards.claimDaily(b)).toMatchObject({ ok: false });
  });

  it('keeps the larger value for max metrics and adds for sums', async () => {
    const a = await makePlayer(t.db);
    await t.db.transaction(async (tx) => {
      await recordEvent(tx, a, 'daily-streak', 5);
      await recordEvent(tx, a, 'daily-streak', 2);
      await recordEvent(tx, a, 'challenges-claimed', 1);
      await recordEvent(tx, a, 'challenges-claimed', 1);
    });
    expect(await row(a, 'clockwork')).toMatchObject({ progress: 5, tier: 1 });
    expect(await row(a, 'contractor')).toMatchObject({ progress: 2, tier: 0 });
  });
});

describe('notices', () => {
  it('words career and feat unlocks, with activity for feats and tier V only', () => {
    const career = { playerId: 'x', achievementId: 'grinder', tier: 3, chips: 2500, xp: 200, titleId: 'ach:grinder:3' };
    expect(unlockNotice(career)).toEqual({
      tone: 'good', title: 'Grinder III', body: '+2,500 chips and 200 XP. New title: Regular.',
      emblem: { achievementId: 'grinder', tier: 3 },
    });
    expect(unlockNotice({ ...career, tier: 2, chips: 1000, xp: 100, titleId: null }).body).toBe('+1,000 chips and 100 XP.');
    expect(unlockActivityText(career)).toBeNull();
    expect(unlockActivityText({ ...career, tier: 5 })).toBe('reached Grinder V');
    const feat = { playerId: 'x', achievementId: 'royalty', tier: 1, chips: 25000, xp: 1500, titleId: 'ach:royalty' };
    expect(unlockNotice(feat)).toMatchObject({ title: 'Feat unlocked: Royalty', body: '+25,000 chips and 1,500 XP. New title: Royalty.' });
    expect(unlockActivityText(feat)).toBe('earned the “Royalty” feat');
  });
});

describe('AchievementService reads, showcase and titles', () => {
  it('lists every achievement with zeros for untouched ones', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.recorder.recordHand([fact(randomUUID(), a, 1, WON)], history(randomUUID(), 1, [a]));
    const r = await s.achievements.forPlayer(a);
    expect(r.achievements.map((x) => x.id)).toEqual(ACHIEVEMENTS.map((d) => d.id));
    expect(r.achievements.find((x) => x.id === 'fresh-cheese')).toMatchObject({ progress: 1, tier: 1, unlocks: [{ tier: 1 }] });
    expect(r.achievements.find((x) => x.id === 'royalty')).toEqual({ id: 'royalty', progress: 0, tier: 0, unlocks: [] });
    expect(r.showcase).toEqual([]);
  });

  it('validates the showcase and falls back to an automatic pick', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await t.db.insert(playerAchievements).values([
      { playerId: a, achievementId: 'grinder', progress: 1000 },
      { playerId: a, achievementId: 'fresh-cheese', progress: 1 },
    ]);
    await t.db.transaction((tx) => settle(tx, a));

    const auto = await s.achievements.trophies(a);
    expect(auto).toMatchObject({ auto: true, emblems: 2, total: ACHIEVEMENTS.length });
    expect(auto.showcase.slice(0, 2)).toEqual(['fresh-cheese', 'grinder']);
    expect(auto.unlocked.find((u) => u.id === 'grinder')).toMatchObject({ tier: 3 });

    expect(await s.achievements.setShowcase(a, 'grinder')).toMatchObject({ ok: false });
    expect(await s.achievements.setShowcase(a, [1])).toMatchObject({ ok: false });
    expect(await s.achievements.setShowcase(a, ['grinder', 'grinder'])).toMatchObject({ ok: false, error: 'Each emblem can only go on the shelf once.' });
    expect(await s.achievements.setShowcase(a, ['nope'])).toMatchObject({ ok: false, error: "That emblem doesn't exist." });
    expect(await s.achievements.setShowcase(a, ['royalty'])).toMatchObject({ ok: false, error: "You haven't unlocked that emblem yet." });
    expect(await s.achievements.setShowcase(a, ['a', 'b', 'c', 'd', 'e', 'f'])).toMatchObject({ ok: false, error: 'You can show up to 5 emblems.' });

    expect(await s.achievements.setShowcase(a, ['grinder'])).toEqual({ ok: true, showcase: ['grinder'] });
    expect(await s.achievements.trophies(a)).toMatchObject({ auto: false, showcase: ['grinder'] });
    expect((await s.achievements.forPlayer(a)).showcase).toEqual(['grinder']);
    expect(await s.achievements.setShowcase(a, [])).toEqual({ ok: true, showcase: [] });
    expect((await s.achievements.trophies(a)).auto).toBe(true);
  });

  it('equips earned titles only once their tier is reached', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const [regular, furniture] = achievementTitles(getAchievement('grinder')!);
    expect(await s.shop.equip(a, 'title', regular.id)).toEqual({ ok: false, error: "You haven't earned that title yet." });
    expect(await s.shop.equip(a, 'frame', regular.id)).toMatchObject({ ok: false });
    await t.db.insert(playerAchievements).values({ playerId: a, achievementId: 'grinder', progress: 1000 });
    await t.db.transaction((tx) => settle(tx, a));
    expect(await s.achievements.hasTitle(a, regular.id)).toBe(true);
    expect(await s.achievements.hasTitle(a, furniture.id)).toBe(false);
    expect(await s.shop.equip(a, 'title', furniture.id)).toMatchObject({ ok: false });
    expect(await s.shop.equip(a, 'title', regular.id)).toMatchObject({ ok: true, loadout: { title: regular.id } });
    const card = await s.profiles.card(a);
    expect(card?.cosmetics.title).toBe('Regular');
    // Shop titles still need buying.
    expect(await s.shop.equip(a, 'title', 'title-shark')).toMatchObject({ ok: false, error: "You don't own that yet." });
  });

  it('shows trophies on the profile card', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.recorder.recordHand([fact(randomUUID(), a, 1, WON)], history(randomUUID(), 1, [a]));
    const card = await s.profiles.card(a);
    expect(card?.trophies).toMatchObject({ showcase: ['fresh-cheese'], auto: true, emblems: 1, unlocked: [{ id: 'fresh-cheese', tier: 1 }] });
  });
});

describe('foldFacts', () => {
  it('folds sums and streaks the way live recording does', () => {
    const facts = [true, true, false, true].map((won, i) => fact('t', 'p', i + 1, won ? WON : {}));
    const folded = foldFacts(facts);
    expect(folded.get('grinder')).toEqual({ progress: 4, current: 0 });
    expect(folded.get('pot-taker')).toEqual({ progress: 3, current: 0 });
    expect(folded.get('on-a-heater')).toEqual({ progress: 2, current: 1 });
  });

  it('pays the reward the catalog lists', () => {
    expect(rewardFor(getAchievement('grinder')!, 5)).toEqual({ chips: 10_000, xp: 600 });
  });
});
