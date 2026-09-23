import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChallengeStatus, LeaderboardEntry, PlayerSelf, ProfileCard } from '@poker/shared';
import jwt from 'jsonwebtoken';
import { createAuth } from '../../auth.js';
import { useTestDb } from '../db.js';
import {
  SECRET,
  connect,
  connectError,
  http,
  signIn,
  startServer,
  uniqueName,
  type TestServer,
} from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  server = await startServer(t.db);
});
afterAll(async () => {
  await server?.close();
});

describe('auth', () => {
  it('mock sign-in creates a player with the starting bankroll and a working token', async () => {
    const name = uniqueName('Alice');
    const res = await signIn(server, name);
    expect(res.token).toEqual(expect.any(String));
    expect(res.me).toMatchObject({ name, balance: 10_000, xp: 0 });
    expect(res.me.id).toMatch(/^mock-/);

    const me = await http<PlayerSelf>(server, '/me', { token: res.token });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: res.me.id, balance: 10_000 });

    // Signing in again is the same player, not a fresh bankroll.
    const again = await signIn(server, name);
    expect(again.me.id).toBe(res.me.id);
  });

  it('sanitises names and rejects ones with nothing usable', async () => {
    const res = await signIn(server, '  <b>Cheese</b>   Rat!!  ');
    expect(res.me.name).toBe('bCheeseb Rat');
    expect(res.me.id).toBe('mock-bcheeseb-rat');

    const long = await signIn(server, 'Z'.repeat(60));
    expect(long.me.name).toHaveLength(24);

    for (const body of [{ name: '<<>>!!' }, { name: '   ' }, { name: 42 }, {}, { name: ['Bob'] }]) {
      const r = await http(server, '/auth/mock', { body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body).toEqual({ error: expect.any(String) });
    }
  });

  it('answers a malformed JSON body with a JSON 400, not an HTML stack trace', async () => {
    const r = await http(server, '/auth/mock', { rawBody: '{"name": ' });
    expect(r.status).toBe(400);
    expect(r.contentType).toMatch(/application\/json/);
    expect(r.body).toEqual({ error: expect.any(String) });
    expect(r.text).not.toMatch(/at .*\.js|node_modules|SyntaxError/);

    const big = await http(server, '/auth/mock', { body: { name: 'Big', pad: 'x'.repeat(40_000) } });
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: expect.any(String) });
  });

  it('refuses mock sign-in when it is disabled', async () => {
    const locked = await startServer(t.db, { allowMockAuth: false });
    try {
      const r = await http(locked, '/auth/mock', { body: { name: 'Mallory' } });
      expect(r.status).toBe(404);
    } finally {
      await locked.close();
    }
  });

  it('rejects REST calls without a valid session', async () => {
    const forged = createAuth('not-the-secret').sign({ sub: 'mock-x', name: 'x', avatar: '' });
    for (const token of [undefined, 'garbage', forged]) {
      const r = await http(server, '/me', { token });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: expect.any(String) });
    }
    // Right secret but the wrong algorithm, or expired.
    const hs512 = jwt.sign({ sub: 'mock-x', name: 'x', avatar: '' }, SECRET, { algorithm: 'HS512' });
    const expired = jwt.sign({ sub: 'mock-x', name: 'x', avatar: '', exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);
    for (const token of [hs512, expired]) expect((await http(server, '/me', { token })).status).toBe(401);
    // A valid signature for a player that doesn't exist.
    const ghost = createAuth(SECRET).sign({ sub: 'mock-ghost', name: 'ghost', avatar: '' });
    expect((await http(server, '/me', { token: ghost })).status).toBe(404);
  });

  it('refuses socket connections without a valid session', async () => {
    const ghost = createAuth(SECRET).sign({ sub: 'mock-nobody', name: 'n', avatar: '' });
    const forged = createAuth('wrong').sign({ sub: 'mock-x', name: 'x', avatar: '' });
    expect(await connectError(server, {})).toBe('unauthorized');
    expect(await connectError(server, { token: '' })).toBe('unauthorized');
    expect(await connectError(server, { token: 'not-a-jwt' })).toBe('unauthorized');
    expect(await connectError(server, { token: forged })).toBe('unauthorized');
    expect(await connectError(server, { token: ghost })).toBe('unauthorized');
    expect(await connectError(server, { token: { sub: 'mock-x' } })).toBe('unauthorized');
  });

  it('pushes `me` to a freshly connected socket', async () => {
    const session = await signIn(server, uniqueName('Sock'));
    const c = await connect(server, session);
    const me = await c.state('me', () => true);
    expect(me).toMatchObject({ id: session.me.id, balance: 10_000 });
    c.close();
  });
});

describe('misc routes', () => {
  it('serves health without a session and JSON 404s for unknown API routes', async () => {
    const health = await http(server, '/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok' });

    const { token } = await signIn(server, uniqueName('Lost'));
    const missing = await http(server, '/nope', { token });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String) });
  });
});

describe('leaderboard, profiles, stats', () => {
  it('validates the leaderboard metric', async () => {
    const { token } = await signIn(server, uniqueName('Board'));
    const bad = await http(server, '/leaderboard?metric=chips_stolen', { token });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'Unknown metric' });

    const bankroll = await http<LeaderboardEntry[]>(server, '/leaderboard?metric=bankroll&limit=500', { token });
    expect(bankroll.status).toBe(200);
    expect(bankroll.body.length).toBeGreaterThan(0);
    expect(bankroll.body.length).toBeLessThanOrEqual(100);
    for (let i = 1; i < bankroll.body.length; i++) expect(bankroll.body[i - 1].value).toBeGreaterThanOrEqual(bankroll.body[i].value);

    const weekly = await http<LeaderboardEntry[]>(server, '/leaderboard?metric=net_profit&period=week', { token });
    expect(weekly.status).toBe(200);
    expect(Array.isArray(weekly.body)).toBe(true);

    expect((await http(server, '/leaderboard')).status).toBe(401);
  });

  it('serves profile cards and stats', async () => {
    const a = await signIn(server, uniqueName('Prof'));
    const b = await signIn(server, uniqueName('Viewer'));
    const card = await http<ProfileCard>(server, `/players/${encodeURIComponent(a.me.id)}/profile`, { token: b.token });
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ id: a.me.id, name: a.me.name, bankroll: 10_000, level: 1, badges: [], recentForm: [] });
    expect(card.body.stats.handsPlayed).toBe(0);

    expect((await http(server, '/players/mock-nobody-here/profile', { token: b.token })).status).toBe(404);
    expect((await http(server, `/players/${a.me.id}/profile`)).status).toBe(401);

    const stats = await http<{ summary: { handsPlayed: number; playerId: string }; curve: unknown[] }>(
      server, `/players/${a.me.id}/stats`, { token: b.token });
    expect(stats.status).toBe(200);
    expect(stats.body.summary).toMatchObject({ playerId: a.me.id, handsPlayed: 0 });
    expect(stats.body.curve).toEqual([]);

    const hands = await http<unknown[]>(server, '/me/hands', { token: a.token });
    expect(hands.status).toBe(200);
    expect(hands.body).toEqual([]);
  });
});

describe('shop', () => {
  it('buys and equips items, pushing `me` to the socket afterwards', async () => {
    const session = await signIn(server, uniqueName('Buyer'));
    const c = await connect(server, session);
    await c.state('me', () => true);
    const token = session.token;

    const buy = await http(server, '/shop/purchase', { token, body: { itemId: 'title-nit', nonce: 'nonce-title-nit-1' } });
    expect(buy.status).toBe(200);
    expect(buy.body).toMatchObject({ ok: true, balance: 9000, quantity: 1 });
    await c.state('me', (m) => m.balance === 9000 && m.owned['title-nit'] === 1);

    // Retrying the same purchase (same nonce) doesn't charge twice.
    const retry = await http(server, '/shop/purchase', { token, body: { itemId: 'title-nit', nonce: 'nonce-title-nit-1' } });
    expect(retry.status).toBe(200);
    expect((await http<PlayerSelf>(server, '/me', { token })).body.balance).toBe(9000);

    // A second purchase of a permanent item is refused.
    const twice = await http(server, '/shop/purchase', { token, body: { itemId: 'title-nit', nonce: 'nonce-title-nit-2' } });
    expect(twice.status).toBe(409);
    expect(twice.body).toMatchObject({ ok: false, error: 'You already own this.' });

    for (const body of [
      { itemId: 'no-such-item', nonce: 'nonce-abcdefgh' },
      { itemId: 'felt-classic', nonce: 'nonce-abcdefgh' },
      { itemId: 'title-shark', nonce: 'bad nonce!' },
      { itemId: 'felt-high-roller', nonce: 'nonce-level-gated' },
    ]) {
      const r = await http(server, '/shop/purchase', { token, body });
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.body).toMatchObject({ ok: false, error: expect.any(String) });
    }

    const equip = await http(server, '/shop/equip', { token, body: { slot: 'title', itemId: 'title-nit' } });
    expect(equip.status).toBe(200);
    expect(equip.body).toMatchObject({ ok: true, loadout: { title: 'title-nit' } });
    await c.state('me', (m) => m.loadout.title === 'title-nit');

    expect((await http(server, '/shop/equip', { token, body: { slot: 'hat', itemId: 'title-nit' } })).status).toBe(400);
    const wrongSlot = await http(server, '/shop/equip', { token, body: { slot: 'felt', itemId: 'title-nit' } });
    expect(wrongSlot.status).toBe(409);
    const notOwned = await http(server, '/shop/equip', { token, body: { slot: 'title', itemId: 'title-shark' } });
    expect(notOwned.status).toBe(409);
    expect(notOwned.body).toMatchObject({ ok: false, error: "You don't own that yet." });
    c.close();
  });
});

describe('challenges and daily bonus', () => {
  it('lists challenges and refuses claims that are not earned', async () => {
    const { token } = await signIn(server, uniqueName('Chal'));
    const list = await http<ChallengeStatus[]>(server, '/challenges', { token });
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.map((c) => c.period)).toEqual(expect.arrayContaining(['daily', 'weekly']));
    for (const c of list.body) expect(c).toMatchObject({ progress: 0, completed: false, claimed: false });

    const unknown = await http(server, '/challenges/claim', { token, body: { periodKey: list.body[0].periodKey, challengeId: 'nope' } });
    expect(unknown.status).toBe(409);
    expect(unknown.body).toEqual({ ok: false, error: 'Unknown challenge.' });

    const early = await http(server, '/challenges/claim', { token, body: { periodKey: list.body[0].periodKey, challengeId: list.body[0].id } });
    expect(early.status).toBe(409);
    expect(early.body).toEqual({ ok: false, error: 'Finish the challenge first.' });

    expect((await http(server, '/challenges/claim', { token, body: {} })).status).toBe(409);
  });

  it('pays the daily bonus once per day', async () => {
    const session = await signIn(server, uniqueName('Daily'));
    expect(session.me.daily.available).toBe(true);
    const c = await connect(server, session);
    await c.state('me', () => true);

    const first = await http<{ ok: true; amount: number; balance: number; streak: number }>(
      server, '/me/daily', { token: session.token, method: 'POST' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, streak: 1, amount: session.me.daily.nextAmount });
    expect(first.body.balance).toBe(10_000 + first.body.amount);
    await c.state('me', (m) => !m.daily.available && m.balance === first.body.balance);

    const second = await http(server, '/me/daily', { token: session.token, method: 'POST' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ ok: false });
    expect((await http<PlayerSelf>(server, '/me', { token: session.token })).body.balance).toBe(first.body.balance);
    c.close();
  });
});
