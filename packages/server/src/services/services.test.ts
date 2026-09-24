import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  activeChallenges, dmChannel, levelUpReward, periodKeyFor, roomChannel, totalXpForLevel,
  type PlayerHandStat,
} from '@poker/shared';
import { eq } from 'drizzle-orm';
import { createServices } from './index.js';
import { players } from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { fact as baseFact } from './stats-aggregate.test.js';
import type { HandHistoryRecord } from './hand-facts.js';
import { recomputeAllPlayerStats } from './recompute.js';

const t = useTestDb();
const NOW = new Date('2026-09-23T12:00:00Z');
const svc = () => createServices(t.db, () => NOW);

function fact(tableId: string, playerId: string, handNumber: number, over: Partial<PlayerHandStat> = {}): PlayerHandStat {
  return baseFact({ tableId, playerId, handNumber, ...over });
}

function history(tableId: string, handNumber: number, ids: string[], shown: string[] = []): HandHistoryRecord {
  return {
    tableId, handNumber, board: [],
    pots: [{ amount: 100, winnerIds: [ids[0]], handLabel: null }],
    players: ids.map((id, i) => ({
      id, seat: i, cards: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }],
      shown: shown.includes(id), net: i === 0 ? 50 : -50, handLabel: null, result: i === 0 ? 'won' : 'lost',
    })),
  };
}

describe('HandRecorder', () => {
  it('records facts, aggregates and XP exactly once', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    const table = randomUUID();
    const facts = [
      fact(table, a, 1, { result: 'won', chipsWon: 100, netResult: 50, chipsContributed: 50 }),
      fact(table, b, 1, { result: 'lost', netResult: -50, chipsContributed: 50 }),
    ];
    const first = await s.recorder.recordHand(facts, history(table, 1, [a, b]));
    expect(first.xp).toEqual({ [a]: 8, [b]: 2 });
    const replay = await s.recorder.recordHand(facts, history(table, 1, [a, b]));
    expect(replay.xp).toEqual({});
    expect(await s.stats.summary(a)).toMatchObject({ handsPlayed: 1, handsWon: 1, netProfit: 50 });
    const [row] = await t.db.select().from(players).where(eq(players.discordUserId, a));
    expect(row.xp).toBe(8);
  });

  it("doesn't lose a new player's first hands finishing at several tables at once", async () => {
    const s = svc();
    for (let round = 0; round < 5; round++) {
      const a = await makePlayer(t.db);
      const b = await makePlayer(t.db);
      const tables = [randomUUID(), randomUUID(), randomUUID()];
      await Promise.all([
        ...tables.map((tid) => s.recorder.recordHand(
          [fact(tid, a, 1, { result: 'won', chipsWon: 100, netResult: 50 }), fact(tid, b, 1)],
          history(tid, 1, [a, b]),
        )),
        s.recorder.recordSession(a, 1000),
        s.recorder.recordSession(b, 1000),
      ]);
      expect(await s.stats.summary(a)).toMatchObject({ handsPlayed: 3, handsWon: 3, netProfit: 150 });
      expect(await s.stats.summary(b)).toMatchObject({ handsPlayed: 3 });
    }
  });

  it('credits a chip reward on level-up', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await t.db.update(players).set({ xp: totalXpForLevel(2) - 1 }).where(eq(players.discordUserId, a));
    const out = await s.recorder.recordHand([fact(randomUUID(), a, 1)], history(randomUUID(), 1, [a]));
    expect(out.levelUps).toEqual([{ playerId: a, level: 2, reward: levelUpReward(2) }]);
    expect(await s.bank.balance(a)).toBe(10_000 + levelUpReward(2));
  });

  it('advances challenge progress and flags completion once', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const daily = activeChallenges('daily', periodKeyFor('daily', NOW));
    const table = randomUUID();
    const completedIds = new Set<string>();
    for (let hand = 1; hand <= 30; hand++) {
      const out = await s.recorder.recordHand([
        fact(table, a, hand, {
          result: 'won', chipsWon: 5000, netResult: 4000, potTotal: 5000, wentToShowdown: true,
          handCategory: 'four-of-a-kind', finalStreet: 'showdown', pfr: true, vpip: true, wasAllIn: true,
        }),
      ], history(table, hand, [a]));
      for (const c of out.completed) {
        expect(completedIds.has(c.challenge.id)).toBe(false);
        completedIds.add(c.challenge.id);
      }
    }
    // A winning, showdown, all-in, pre-flop-raising quads hand satisfies every daily metric.
    for (const d of daily) expect(completedIds.has(d.id)).toBe(true);
    const list = await s.rewards.challenges(a);
    expect(list.filter((c) => c.period === 'daily').every((c) => c.completed && !c.claimed)).toBe(true);
    expect(await s.rewards.unclaimedCount(a)).toBeGreaterThanOrEqual(3);

    const target = daily[0];
    const before = await s.bank.balance(a);
    const claim = await s.rewards.claimChallenge(a, periodKeyFor('daily', NOW), target.id);
    expect(claim).toMatchObject({ ok: true, chips: target.reward.chips });
    expect(await s.bank.balance(a)).toBeGreaterThanOrEqual(before + target.reward.chips);
    expect(await s.rewards.claimChallenge(a, periodKeyFor('daily', NOW), target.id)).toMatchObject({ ok: false, error: 'Already claimed.' });
  });

  it('refuses to claim an unfinished challenge', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const d = activeChallenges('daily', periodKeyFor('daily', NOW))[0];
    expect(await s.rewards.claimChallenge(a, periodKeyFor('daily', NOW), d.id)).toMatchObject({ ok: false });
  });

  it('recomputes aggregates from facts while keeping session time', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.recorder.recordHand([fact(randomUUID(), a, 1, { result: 'won', chipsWon: 10, netResult: 10 })], history(randomUUID(), 1, [a]));
    await s.recorder.recordSession(a, 90_000);
    await recomputeAllPlayerStats(t.db);
    expect(await s.stats.summary(a)).toMatchObject({ handsPlayed: 1, netProfit: 10, sessionsPlayed: 1, totalPlayMs: 90_000 });
  });
});

describe('StatsRepository', () => {
  it('serves hand history without leaking unshown opponent cards', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    const c = await makePlayer(t.db);
    const table = randomUUID();
    await s.recorder.recordHand([fact(table, a, 1), fact(table, b, 1), fact(table, c, 1)], history(table, 1, [a, b, c], [c]));
    const [hand] = await s.stats.history(a);
    const cards = Object.fromEntries(hand.players.map((p) => [p.id, p.cards]));
    expect(cards[a]).not.toBeNull();
    expect(cards[b]).toBeNull();
    expect(cards[c]).not.toBeNull();
  });

  it("serves each player's card back, falling back for old rows", async () => {
    const s = svc();
    const [a, b] = [await makePlayer(t.db), await makePlayer(t.db)];
    const table = randomUUID();
    const rec = history(table, 1, [a, b]);
    rec.players[1].cardBack = 'back-navy';
    await s.recorder.recordHand([fact(table, a, 1), fact(table, b, 1)], rec);
    const [hand] = await s.stats.history(a);
    expect(Object.fromEntries(hand.players.map((p) => [p.id, p.cardBack]))).toEqual({ [a]: 'back-classic', [b]: 'back-navy' });
  });

  // The database may hold other tests' (or earlier runs') players, so these only
  // assert on this test's own players and on ranks relative to the whole board.

  /** `rank()` semantics: 1 + the number of entries strictly ahead. */
  const expectedRank = (entries: { value: number }[], value: number) => 1 + entries.filter((e) => e.value > value).length;

  it('ranks leaderboards with shared ranks for ties', async () => {
    const s = svc();
    const ids = [await makePlayer(t.db, 'lb'), await makePlayer(t.db, 'lb'), await makePlayer(t.db, 'lb')];
    await t.db.update(players).set({ chipBalance: 1_000_000 }).where(eq(players.discordUserId, ids[0]));
    await t.db.update(players).set({ chipBalance: 1_000_000 }).where(eq(players.discordUserId, ids[1]));
    const top = await s.stats.leaderboard('bankroll', 'all', 3, ids[1]);
    expect(top.entries.length).toBeLessThanOrEqual(3);
    expect(top.me).toMatchObject({ value: 1_000_000, player: { id: ids[1] } });
    const tiedWith = (await s.stats.leaderboard('bankroll', 'all', 1, ids[0])).me!;
    expect(tiedWith).toMatchObject({ rank: top.me!.rank, value: 1_000_000 });
    const behind = (await s.stats.leaderboard('bankroll', 'all', 1, ids[2])).me!;
    expect(behind.rank).toBeGreaterThan(top.me!.rank + 1);
    // In the list itself, equal values share a rank and ranks follow rank() semantics.
    const everyone = await s.stats.leaderboard('bankroll', 'all', 100_000);
    for (const e of everyone.entries) expect(e.rank).toBe(expectedRank(everyone.entries, e.value));
    expect(everyone.entries.filter((e) => ids.slice(0, 2).includes(e.player.id)).map((e) => e.rank))
      .toEqual([top.me!.rank, top.me!.rank]);

    const table = randomUUID();
    await s.recorder.recordHand([fact(table, ids[2], 1, { result: 'won', chipsWon: 999_999, netResult: 999_999 })], history(table, 1, [ids[2]]));
    const week = await s.stats.leaderboard('net_profit', 'week', 1, ids[2]);
    expect(week.entries).toHaveLength(1);
    expect(week.me).toMatchObject({ value: 999_999, player: { id: ids[2] } });
    // No hands this week: not on the board.
    expect((await s.stats.leaderboard('net_profit', 'week', 1, ids[0])).me).toBeNull();
  });

  it('finds your rank outside the limit, sharing ranks with ties', async () => {
    const s = svc();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await makePlayer(t.db, 'rk'));
    const nets = [9_000_000, 5_000_000, 5_000_000, 4_000_000, -9_000_000];
    const table = randomUUID();
    for (const [i, id] of ids.entries()) {
      await s.recorder.recordHand([fact(table, id, i + 1, { netResult: nets[i], result: nets[i] > 0 ? 'won' : 'lost', chipsWon: Math.max(0, nets[i]) })], history(table, i + 1, [id]));
    }
    const all = await s.stats.leaderboard('net_profit', 'week', 100_000);
    const rankOf = (id: string) => all.entries.find((e) => e.player.id === id)!.rank;
    expect(rankOf(ids[1])).toBe(rankOf(ids[2]));
    for (const [i, id] of ids.entries()) expect(rankOf(id)).toBe(expectedRank(all.entries, nets[i]));
    // Everyone tied at 5M sits between our 5M and 4M players.
    const tiedAt5m = all.entries.filter((e) => e.value === 5_000_000).length;
    expect(rankOf(ids[3])).toBe(rankOf(ids[1]) + tiedAt5m + all.entries.filter((e) => e.value > 4_000_000 && e.value < 5_000_000).length);

    const top1 = await s.stats.leaderboard('net_profit', 'week', 1, ids[4]);
    expect(top1.entries).toHaveLength(1);
    expect(top1.me).toMatchObject({ rank: rankOf(ids[4]), value: -9_000_000, player: { id: ids[4] } });
    const tied = await s.stats.leaderboard('net_profit', 'week', 1, ids[2]);
    expect(tied.me).toMatchObject({ rank: rankOf(ids[1]), value: 5_000_000 });

    // Level ranks by XP; the value is the level.
    const level = await s.stats.leaderboard('level', 'all', 1, ids[0]);
    expect(level.me).toMatchObject({ player: { id: ids[0] }, value: level.me!.player.level });
    expect(level.me!.rank).toBeGreaterThanOrEqual(1);
  });
});

describe('ShopService', () => {
  it('buys, equips and prevents double-buying a permanent item', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    expect(await s.shop.equip(a, 'frame', 'frame-brass')).toMatchObject({ ok: false });
    const nonce = randomUUID();
    expect(await s.shop.purchase(a, 'frame-brass', nonce)).toMatchObject({ ok: true, balance: 7000, quantity: 1 });
    // Retrying the same purchase is safe.
    expect(await s.shop.purchase(a, 'frame-brass', nonce)).toMatchObject({ ok: true, balance: 7000 });
    expect(await s.shop.purchase(a, 'frame-brass', randomUUID())).toEqual({ ok: false, error: 'You already own this.' });
    expect(await s.shop.equip(a, 'frame', 'frame-brass')).toMatchObject({ ok: true, loadout: { frame: 'frame-brass' } });
    expect(await s.shop.equip(a, 'title', 'frame-brass')).toMatchObject({ ok: false });
    expect(await s.bank.balance(a)).toBe(7000);
  });

  it('stacks consumables and consumes them one at a time', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.shop.purchase(a, 'throw-tomato', randomUUID());
    await s.shop.purchase(a, 'throw-tomato', randomUUID());
    expect((await s.shop.owned(a))['throw-tomato']).toBe(10);
    for (let i = 0; i < 10; i++) expect(await s.shop.consume(a, 'throw-tomato')).toBe(true);
    expect(await s.shop.consume(a, 'throw-tomato')).toBe(false);
    expect((await s.shop.owned(a))['throw-tomato']).toBeUndefined();
  });

  it('enforces price and level gates', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    expect(await s.shop.purchase(a, 'felt-high-roller', randomUUID())).toMatchObject({ ok: false, error: 'Reach level 10 to buy this.' });
    await t.db.update(players).set({ chipBalance: 100 }).where(eq(players.discordUserId, a));
    expect(await s.shop.purchase(a, 'title-nit', randomUUID())).toMatchObject({ ok: false, error: 'You need 900 more chips.' });
    expect(await s.shop.purchase(a, 'felt-classic', randomUUID())).toMatchObject({ ok: false });
    expect(await s.shop.purchase(a, 'nope', randomUUID())).toMatchObject({ ok: false });
  });
});

describe('RewardsService daily bonus', () => {
  it('pays once a day and grows the streak on consecutive days', async () => {
    let now = new Date('2026-09-20T10:00:00Z');
    const s = createServices(t.db, () => now);
    const a = await makePlayer(t.db);
    expect(await s.rewards.claimDaily(a)).toMatchObject({ ok: true, amount: 500, streak: 1 });
    expect(await s.rewards.claimDaily(a)).toMatchObject({ ok: false });
    now = new Date('2026-09-21T23:59:00Z');
    expect(await s.rewards.claimDaily(a)).toMatchObject({ ok: true, amount: 750, streak: 2 });
    now = new Date('2026-09-23T08:00:00Z'); // missed a day
    expect(await s.rewards.claimDaily(a)).toMatchObject({ ok: true, amount: 500, streak: 1 });
    expect(await s.bank.balance(a)).toBe(10_000 + 500 + 750 + 500);
  });
});

describe('ChatService', () => {
  it('stores room messages and pages history oldest first', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const room = roomChannel(randomUUID());
    for (const body of ['one', 'two', 'three']) expect((await s.chat.send(room, a, body)).ok).toBe(true);
    const hist = await s.chat.history(room);
    expect(hist.map((m) => m.body)).toEqual(['one', 'two', 'three']);
  });

  it('cleans and bounds messages', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const room = roomChannel(randomUUID());
    expect(await s.chat.send(room, a, '   ')).toMatchObject({ ok: false });
    expect(await s.chat.send(room, a, 'x'.repeat(281))).toMatchObject({ ok: false });
    expect(await s.chat.send(room, a, 42)).toMatchObject({ ok: false });
    const r = await s.chat.send(room, a, ' hi' + String.fromCharCode(0x200b, 0x07) + ' there ');
    expect(r.ok && r.message.body).toBe('hi there');
  });

  it('tracks DM conversations and unread counts', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    const ch = dmChannel(a, b);
    await s.chat.send(ch, a, 'hey');
    await s.chat.send(ch, a, 'you there?');
    expect(await s.chat.unreadTotal(b)).toBe(2);
    expect(await s.chat.unreadTotal(a)).toBe(0);
    const [conv] = await s.chat.conversations(b);
    expect(conv).toMatchObject({ channel: ch, unread: 2, partner: { id: a } });
    expect(conv.last?.body).toBe('you there?');
    await s.chat.markRead(b, ch);
    expect(await s.chat.unreadTotal(b)).toBe(0);
  });
});

describe('ProfileService', () => {
  it('builds the self view and a public profile card', async () => {
    const s = svc();
    const a = await makePlayer(t.db);
    await s.shop.purchase(a, 'title-shark', randomUUID());
    await s.shop.equip(a, 'title', 'title-shark');
    const me = await s.profiles.self(a);
    expect(me).toMatchObject({ balance: 5000, level: { level: 1 }, owned: { 'title-shark': 1 }, daily: { available: true } });
    const card = await s.profiles.card(a);
    expect(card).toMatchObject({ id: a, cosmetics: { title: 'Card shark' }, bankroll: 5000, itemsOwned: 1 });
    expect(await s.profiles.card('nobody')).toBeNull();
  });
});
