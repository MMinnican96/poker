import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  activeChallenges, dayKey, periodKeyFor, totalXpForLevel,
  type AchievementsResponse, type PlayerSelf, type ProfileCard, type ShowcaseResult,
} from '@poker/shared';
import { playerAchievements, playerChallenges, players } from '../../db/schema.js';
import { useTestDb } from '../db.js';
import { actor, http, joinAll, player, startServer, uniqueRoom, waitOn, type TestServer } from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  server = await startServer(t.db);
});
afterAll(async () => {
  await server?.close();
});

const RULES = { name: 'Trophy table', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, maxSeats: 6 };

describe('achievements over sockets and REST', () => {
  it('unlocks a feat on the first win, reports progress, and shows it on the profile', { timeout: 20_000 }, async () => {
    const a = await player(server, 'Cheddar');
    const b = await player(server, 'Brie');
    await joinAll([a, b], uniqueRoom('inst-ach'));
    expect(await a.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await a.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: true });
    expect(await b.send('take_seat', { seat: 1, buyIn: 2000 })).toEqual({ ok: true });
    expect(await a.send('start_table')).toEqual({ ok: true });

    const folder = await waitOn([a, b], () => actor([a, b]), 'the first turn');
    const winner = folder === a ? b : a;
    const since = { winner: winner.mark(), folder: folder.mark() };
    expect(await folder.send('act', { type: 'fold' })).toEqual({ ok: true });

    // The winner hears about it; the room sees the feat in its activity feed.
    const notice = await winner.next('notice', (n) => !!n.emblem, { since: since.winner, timeout: 5000 });
    expect(notice).toMatchObject({
      tone: 'good', title: 'Feat unlocked: Fresh cheese', body: '+250 chips and 25 XP. New title: Fresh cheese.',
      emblem: { achievementId: 'fresh-cheese', tier: 1 },
    });
    await folder.next('activity', (e) => e.kind === 'achievement' && e.playerId === winner.id, { since: since.folder });

    const mine = await http<AchievementsResponse>(server, '/achievements', { token: winner.token });
    expect(mine.status).toBe(200);
    const byId = new Map(mine.body.achievements.map((x) => [x.id, x]));
    expect(byId.get('fresh-cheese')).toMatchObject({ progress: 1, tier: 1, unlocks: [{ tier: 1, unlockedAt: expect.any(String) }] });
    expect(byId.get('grinder')).toMatchObject({ progress: 1, tier: 0, unlocks: [] });
    expect(mine.body.showcase).toEqual([]);
    const theirs = await http<AchievementsResponse>(server, '/achievements', { token: folder.token });
    expect(theirs.body.achievements.find((x) => x.id === 'fresh-cheese')).toMatchObject({ tier: 0 });
    expect((await http(server, '/achievements')).status).toBe(401);

    // Other players see the trophy cabinet on the profile card.
    const card = await http<ProfileCard>(server, `/players/${encodeURIComponent(winner.id)}/profile`, { token: folder.token });
    expect(card.body.trophies).toMatchObject({ showcase: ['fresh-cheese'], auto: true, emblems: 1, unlocked: [{ id: 'fresh-cheese', tier: 1 }] });
    expect(card.body).not.toHaveProperty('badges');

    // Showcase: validated field by field, then pinned.
    const put = (token: string, body: unknown) => http<ShowcaseResult>(server, '/achievements/showcase', { token, method: 'PUT', body });
    for (const body of [{}, { ids: 'fresh-cheese' }, { ids: [7] }, { ids: ['royalty'] }, { ids: ['nope'] }, { ids: ['fresh-cheese', 'fresh-cheese'] }]) {
      const r = await put(winner.token, body);
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.body).toEqual({ ok: false, error: expect.any(String) });
    }
    expect((await put(folder.token, { ids: ['fresh-cheese'] })).body).toEqual({ ok: false, error: "You haven't unlocked that emblem yet." });
    expect((await put(winner.token, { ids: ['fresh-cheese'] })).body).toEqual({ ok: true, showcase: ['fresh-cheese'] });
    const pinned = await http<ProfileCard>(server, `/players/${encodeURIComponent(winner.id)}/profile`, { token: folder.token });
    expect(pinned.body.trophies).toMatchObject({ showcase: ['fresh-cheese'], auto: false });

    // The earned title can be equipped; someone who hasn't earned it can't.
    const equip = (token: string) => http(server, '/shop/equip', { token, body: { slot: 'title', itemId: 'ach:fresh-cheese' } });
    expect((await equip(folder.token)).status).toBe(409);
    expect((await equip(winner.token)).status).toBe(200);
    await winner.state('me', (m: PlayerSelf) => m.loadout.title === 'ach:fresh-cheese');
  });

  it('announces unlocks from REST actions as notices', async () => {
    const c = await player(server, 'Gouda');
    const since = c.mark();
    for (const [itemId, nonce] of [['felt-oxblood', 'nonce-gouda-felt'], ['back-navy', 'nonce-gouda-back']]) {
      expect((await http(server, '/shop/purchase', { token: c.token, body: { itemId, nonce } })).status).toBe(200);
    }
    const notice = await c.next('notice', (n) => !!n.emblem, { since });
    expect(notice).toMatchObject({ title: 'Collector I', body: '+500 chips and 50 XP.', emblem: { achievementId: 'collector', tier: 1 } });
    await c.state('me', (m: PlayerSelf) => m.balance === 10_000 - 5000 - 2000 + 500); // felt, back, Collector I
  });

  it('announces the daily bonus unlock and the level-up it pays', async () => {
    const c = await player(server, 'Stilton');
    const d = await player(server, 'Edam');
    await joinAll([c, d], uniqueRoom('inst-daily'));
    // Two days in a row already, one XP short of level 3: today's claim makes Clockwork I, whose XP levels up.
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    await t.db.update(players).set({ dailyStreak: 2, lastDailyClaim: yesterday, xp: totalXpForLevel(3) - 1 })
      .where(eq(players.discordUserId, c.id));
    const since = { c: c.mark(), d: d.mark() };

    const r = await http(server, '/me/daily', { token: c.token, body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true, streak: 3,
      unlocks: [{ achievementId: 'clockwork', tier: 1 }],
      levelUps: [{ playerId: c.id, level: 3, reward: 750 }],
    });
    expect(await c.next('notice', (n) => !!n.emblem, { since: since.c })).toMatchObject({
      title: 'Clockwork I', emblem: { achievementId: 'clockwork', tier: 1 },
    });
    expect(await c.next('notice', (n) => n.title === 'Level 3!', { since: since.c })).toMatchObject({ tone: 'good', body: '+750 chips' });
    expect(await d.next('activity', (e) => e.kind === 'level-up' && e.playerId === c.id, { since: since.d }))
      .toMatchObject({ playerName: expect.stringContaining('Stilton'), text: 'reached level 3' });
  });

  it('announces the unlock and level-up from claiming a challenge', async () => {
    const c = await player(server, 'Comte');
    const now = new Date();
    const periodKey = periodKeyFor('daily', now);
    const [challenge] = activeChallenges('daily', periodKey);
    await t.db.insert(playerChallenges).values({
      playerId: c.id, periodKey, challengeId: challenge.id, progress: challenge.goal, completedAt: now,
    });
    // Four claims already: this one makes Contractor I.
    await t.db.insert(playerAchievements).values({ playerId: c.id, achievementId: 'contractor', progress: 4 });
    await t.db.update(players).set({ xp: totalXpForLevel(3) - 1 }).where(eq(players.discordUserId, c.id));
    const since = c.mark();

    const r = await http(server, '/challenges/claim', { token: c.token, body: { periodKey, challengeId: challenge.id } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, unlocks: [{ achievementId: 'contractor', tier: 1 }] });
    expect(r.body.levelUps).toContainEqual({ playerId: c.id, level: 3, reward: 750 });
    expect(await c.next('notice', (n) => !!n.emblem, { since })).toMatchObject({
      title: 'Contractor I', emblem: { achievementId: 'contractor', tier: 1 },
    });
    await c.next('notice', (n) => n.title === 'Level 3!', { since });
  });
});
