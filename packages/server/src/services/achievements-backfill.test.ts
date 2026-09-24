import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import { totalXpForLevel, type Card } from '@poker/shared';
import type { Db } from '../db/client.js';
import {
  appMeta, chipTransactions, handHistory, playerAchievements, playerChallenges, playerHandStats, playerItems, players,
} from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { Bank } from './bank.js';
import { ACHIEVEMENTS_BACKFILL_KEY, backfillAchievementsOnce, recomputeAchievements } from './achievements-backfill.js';

const t = useTestDb();

const AA: [Card, Card] = [{ rank: 'A', suit: 'hearts' }, { rank: 'A', suit: 'spades' }];

/** A fact and its history as a pre-achievements server stored them (no new columns). */
async function oldHand(
  playerId: string, handNumber: number, won: boolean,
  { tableId = randomUUID(), showdown = false, createdAt = new Date(Date.UTC(2026, 0, 1, 0, handNumber)) } = {},
) {
  await t.db.insert(playerHandStats).values({
    tableId, playerId, handNumber, seat: 0, position: 0, bigBlind: 50, chipsContributed: 50,
    chipsWon: won ? 100 : 0, netResult: won ? 50 : -50, result: won ? 'won' : 'lost', handCategory: null,
    potTotal: 100, wentToShowdown: showdown, vpip: true, pfr: false, aggressiveActions: 0, passiveActions: 1,
    wasAllIn: false, finalStreet: showdown ? 'showdown' : 'pre-flop', durationMs: 60_000, createdAt,
  });
  await t.db.insert(handHistory).values({
    tableId, handNumber, board: [], pots: [], playerIds: [playerId],
    players: [{ id: playerId, seat: 0, cards: AA, shown: showdown, net: 0, handLabel: null, result: won ? 'won' : 'lost' }],
  });
}

async function tierOf(playerId: string, achievementId: string) {
  const [r] = await t.db.select().from(playerAchievements)
    .where(and(eq(playerAchievements.playerId, playerId), eq(playerAchievements.achievementId, achievementId)));
  return r;
}

async function achievementCredits(playerId: string) {
  return t.db.select().from(chipTransactions)
    .where(and(eq(chipTransactions.playerId, playerId), like(chipTransactions.idempotencyKey, 'achievement:%')));
}

describe('recomputeAchievements', () => {
  it('credits past play and current state, never lowers progress, and pays nothing twice', async () => {
    const bank = new Bank(t.db);
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    for (const [n, won, showdown] of [[1, true, true], [2, true, false], [3, false, false], [4, true, true]] as const) {
      await oldHand(a, n, won, { showdown });
    }
    await t.db.update(players).set({ dailyStreak: 7 }).where(eq(players.discordUserId, a));
    await t.db.insert(playerItems).values([
      { playerId: a, itemId: 'felt-oxblood' }, { playerId: a, itemId: 'back-navy' }, { playerId: a, itemId: 'throw-tomato', quantity: 5 },
    ]);
    const key = '2026-01-01';
    await t.db.insert(playerChallenges).values(['d-play-25', 'd-win-8', 'd-trips', 'd-pfr-5', 'd-flops-12'].map((challengeId) => ({
      playerId: a, periodKey: key, challengeId, progress: 99, completedAt: new Date(), claimedAt: new Date(),
    })));
    // Recorded live since the deploy: more than the facts alone say.
    await t.db.insert(playerAchievements).values({ playerId: a, achievementId: 'grinder', progress: 60 });
    await t.db.update(players).set({ xp: totalXpForLevel(10) }).where(eq(players.discordUserId, b));
    const before = { a: await bank.balance(a), b: await bank.balance(b) };

    const first = await recomputeAchievements(t.db);
    expect(first.unlocks).toBeGreaterThan(0);
    expect(await tierOf(a, 'grinder')).toMatchObject({ progress: 60, tier: 1 });
    expect(await tierOf(a, 'fresh-cheese')).toMatchObject({ progress: 3, tier: 1 });
    expect(await tierOf(a, 'on-a-heater')).toMatchObject({ progress: 2, current: 1, tier: 0 });
    // Hole cards from hand history, counted only where they were tabled at showdown.
    expect(await tierOf(a, 'deep-pockets')).toMatchObject({ progress: 2 });
    expect(await tierOf(a, 'clockwork')).toMatchObject({ progress: 7, tier: 2 });
    expect(await tierOf(a, 'collector')).toMatchObject({ progress: 2, tier: 1 });
    expect(await tierOf(a, 'contractor')).toMatchObject({ progress: 5, tier: 1 });
    expect(await tierOf(b, 'made-rat')).toMatchObject({ tier: 2 });

    const paidA = (await achievementCredits(a)).reduce((s, r) => s + r.amount, 0);
    expect(paidA).toBe(500 + 250 + 500 + 1000 + 500 + 500); // grinder I, fresh cheese, clockwork I+II, collector I, contractor I
    expect(await bank.balance(a)).toBeGreaterThanOrEqual(before.a + paidA);

    const creditsA = (await achievementCredits(a)).length;
    const balances = { a: await bank.balance(a), b: await bank.balance(b) };
    const second = await recomputeAchievements(t.db);
    expect(second.unlocks).toBe(0);
    expect(await achievementCredits(a)).toHaveLength(creditsA);
    expect({ a: await bank.balance(a), b: await bank.balance(b) }).toEqual(balances);
    expect(await tierOf(a, 'fresh-cheese')).toMatchObject({ progress: 3, tier: 1 });
  });

  it('keeps the streak in progress on an existing row but seeds it on a new one', async () => {
    const a = await makePlayer(t.db);
    for (const n of [1, 2, 3]) await oldHand(a, n, true);
    // Live recording moved on after the fold's snapshot: its streak stands.
    await t.db.insert(playerAchievements).values({ playerId: a, achievementId: 'on-a-heater', progress: 5, current: 5 });
    await recomputeAchievements(t.db);
    expect(await tierOf(a, 'on-a-heater')).toMatchObject({ progress: 5, current: 5 });
    await t.db.update(playerAchievements).set({ progress: 1, current: 0 })
      .where(and(eq(playerAchievements.playerId, a), eq(playerAchievements.achievementId, 'on-a-heater')));
    await recomputeAchievements(t.db);
    expect(await tierOf(a, 'on-a-heater')).toMatchObject({ progress: 3, current: 0 });
    const b = await makePlayer(t.db);
    await oldHand(b, 1, true);
    await recomputeAchievements(t.db);
    expect(await tierOf(b, 'on-a-heater')).toMatchObject({ progress: 1, current: 1 });
  });

  it("reads each player's facts in batches, in order, without skipping or repeating any", async () => {
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    // Same timestamp for several facts (ties break on hand number, then id), and a sub-millisecond gap.
    const at = new Date(Date.UTC(2026, 0, 1));
    for (const n of [1, 2, 3, 4, 5]) await oldHand(a, n, n !== 3, { createdAt: at });
    await oldHand(a, 6, true, { createdAt: new Date(at.getTime() + 60_000) });
    await oldHand(a, 7, true, { createdAt: new Date(at.getTime() + 120_000) });
    // Hand 6 ends a batch; a cursor cut to milliseconds would read it twice.
    await t.db.execute(sql`update player_hand_stats set created_at = created_at + interval '0.4 milliseconds'
      where player_id = ${a} and hand_number = 6`);
    await oldHand(b, 1, true);
    const r = await recomputeAchievements(t.db, { batchSize: 2 });
    expect(r.facts).toBe((await t.db.select().from(playerHandStats)).length); // every fact once
    expect(await tierOf(a, 'grinder')).toMatchObject({ progress: 7 });
    expect(await tierOf(a, 'pot-taker')).toMatchObject({ progress: 6 });
    expect(await tierOf(a, 'on-a-heater')).toMatchObject({ progress: 4, current: 4 });
    expect(await tierOf(b, 'grinder')).toMatchObject({ progress: 1 });
  });
});

describe('backfillAchievementsOnce', () => {
  it('runs once, then skips', async () => {
    const logs: string[] = [];
    expect(await backfillAchievementsOnce(t.db, (m) => logs.push(m))).toBe('ran');
    const [marker] = await t.db.select().from(appMeta).where(eq(appMeta.key, ACHIEVEMENTS_BACKFILL_KEY));
    expect(marker).toBeDefined();
    expect(await backfillAchievementsOnce(t.db, (m) => logs.push(m))).toBe('skipped');
    expect(logs).toHaveLength(1);
  });

  it('logs a failure without throwing', async () => {
    const broken = { select: () => { throw new Error('db down'); } } as unknown as Db;
    const errors: unknown[] = [];
    expect(await backfillAchievementsOnce(broken, (_m, err) => errors.push(err))).toBe('failed');
    expect(errors).toHaveLength(1);
  });
});
