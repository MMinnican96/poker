import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Card, PlayerSelf, TableView } from '@poker/shared';
import { chipTransactions } from '../../db/schema.js';
import type { HandHistoryView } from '../../services/stats-repo.js';
import { useTestDb } from '../db.js';
import {
  actor,
  connect,
  driveUntil,
  http,
  joinAll,
  passive,
  playHands,
  waitOn,
  player,
  startServer,
  type Strategy,
  type TestClient,
  type TestServer,
  uniqueRoom,
} from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  server = await startServer(t.db);
});
afterAll(async () => {
  await server?.close();
});

const newRoom = () => uniqueRoom('inst-table');

const RULES = { name: 'E2E table', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, maxSeats: 6 };
const cardJson = (c: Card) => JSON.stringify(c);
const countCards = (raw: string) => (raw.match(/"suit":/g) ?? []).length;

async function balance(c: TestClient): Promise<number> {
  return (await http<PlayerSelf>(server, '/me', { token: c.token })).body.balance;
}

/** Chips minted by level-ups (the only way chips enter play during a hand). */
async function minted(ids: string[]): Promise<number> {
  let total = 0;
  for (const id of ids) {
    const [row] = await t.db.select({ s: sql<number>`coalesce(sum(amount),0)::int` }).from(chipTransactions)
      .where(sql`${chipTransactions.playerId} = ${id} and ${chipTransactions.type} = 'level-up'`);
    total += Number(row.s);
  }
  return total;
}

/** Open a table as `host` with everyone else watching; seat the given clients. */
async function openAndSeat(host: TestClient, others: TestClient[], seated: TestClient[], buyIn = 2000) {
  const room = newRoom();
  await joinAll([host, ...others], room);
  expect(await host.send('open_table', { rules: RULES })).toEqual({ ok: true });
  for (const [i, c] of seated.entries()) {
    expect(await c.send('take_seat', { seat: i, buyIn })).toEqual({ ok: true });
  }
  return room;
}

describe('a full table over sockets', () => {
  it('opens, seats, deals privately, plays hands and cashes everyone out', { timeout: 30_000 }, async () => {
    const room = newRoom();
    const a = await player(server, 'Host');
    const b = await player(server, 'Guest');
    const c = await player(server, 'Rail');
    await joinAll([a, b, c], room);

    // --- open: rules are validated and errors come back in the ack
    expect(await a.send('open_table', { rules: { smallBlind: 7, bigBlind: 13 } }))
      .toEqual({ ok: false, error: 'Pick one of the listed blind levels.' });
    expect(await a.send('open_table', { rules: { maxSeats: 12 } })).toEqual({ ok: false, error: 'Seats must be 2–9.' });
    expect(await a.send('open_table', { rules: { turnSeconds: 7 } })).toMatchObject({ ok: false });
    expect(await a.send('open_table', { rules: { feltId: 'felt-oxblood' } })).toEqual({ ok: false, error: "You don't own that felt." });
    expect(await a.send('start_table')).toEqual({ ok: false, error: 'There is no table open.' });
    expect(await a.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await b.send('open_table', { rules: RULES })).toMatchObject({ ok: false, error: expect.stringContaining('already open') });

    const opened = await a.state('table_state', () => true);
    expect(opened).toMatchObject({ instanceId: room, hostId: a.id, status: 'open', rules: RULES, hand: null });
    expect(opened.you).toMatchObject({ id: a.id, role: 'spectator', seat: null, bankroll: 10_000 });
    await c.state('lobby_state', (s) => s.table?.hostId === a.id && s.table.rules.name === RULES.name);

    // --- watch + seat
    expect(await c.send('watch_table')).toEqual({ ok: true });
    await c.state('table_state', (v) => v.you.role === 'spectator');
    await a.state('lobby_state', (s) => s.members.find((m) => m.id === c.id)?.presence === 'watching');

    expect(await a.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: true });
    expect(await b.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: false, error: 'That seat is taken.' });
    expect(await b.send('take_seat', { seat: 1, buyIn: 999 })).toMatchObject({ ok: false });
    expect(await b.send('take_seat', { seat: 1, buyIn: 2000 })).toEqual({ ok: true });

    expect(await balance(a)).toBe(8000);
    expect(await balance(b)).toBe(8000);
    await a.state('me', (m) => m.balance === 8000);
    await b.state('me', (m) => m.balance === 8000);
    await a.state('table_state', (v) => v.you.role === 'seated' && v.you.seat === 0 && v.you.bankroll === 8000);
    await c.state('lobby_state', (s) => s.members.find((m) => m.id === a.id)?.presence === 'playing');

    // --- start: host only
    expect(await b.send('start_table')).toEqual({ ok: false, error: 'Only the host can start the game.' });
    expect(await a.send('start_table')).toEqual({ ok: true });
    const first = (await waitOn([a, b], () => actor([a, b]), 'the first turn')).table!;
    expect(first.hand?.handNumber).toBe(1);

    // --- nobody can act out of turn, or for someone else
    const mover = actor([a, b])!;
    const waiter = mover === a ? b : a;
    expect(await waiter.send('act', { type: 'call' })).toEqual({ ok: false, error: "It isn't your turn." });
    expect(await waiter.raw('act', { type: 'fold', playerId: mover.id })).toEqual({ ok: false, error: "It isn't your turn." });
    expect(await c.send('act', { type: 'check' })).toEqual({ ok: false, error: "It isn't your turn." });
    expect(await mover.send('act', { type: 'raise', amount: 1 })).toMatchObject({ ok: false });
    expect(actor([a, b])).toBe(mover);

    // --- play: hand 1 is folded pre-flop, then two hands checked/called down to showdown
    const foldFirst: Strategy = (v) => (v.hand!.handNumber === 1 ? { type: 'fold' } : passive(v));
    const played = await playHands([a, b], 3, foldFirst);
    expect(played).toEqual([1, 2, 3]);
    const r1 = a.results.get(1)!.hand!.result!;
    expect(r1.wentToShowdown).toBe(false);
    expect(r1.shown).toEqual({});
    const r2 = a.results.get(2)!.hand!.result!;
    expect(r2.wentToShowdown).toBe(true);
    expect(Object.keys(r2.shown).sort()).toEqual([a.id, b.id].sort());

    // --- privacy: each client only ever saw its own hole cards (and nothing deck-like)
    const holeCards = (x: TestClient, hand: number): Card[] => {
      const view = x.all('table_state').find((v) => v.hand?.handNumber === hand && v.you.seat !== null
        && v.seats[v.you.seat].player?.holeCards);
      return view ? view.seats[view.you.seat!].player!.holeCards! : [];
    };
    for (const hand of [1, 2, 3]) {
      const cards = new Map([a, b].map((x) => [x.id, holeCards(x, hand)]));
      expect(cards.get(a.id)).toHaveLength(2);
      expect(cards.get(b.id)).toHaveLength(2);
      for (const viewer of [a, b, c]) {
        for (const rec of viewer.log) {
          expect(rec.raw).not.toMatch(/"deck"|"burn"|"seed"/);
          // The lobby summary never carries cards at all.
          if (rec.event === 'lobby_state') expect(countCards(rec.raw)).toBe(0);
          if (rec.event !== 'table_state') continue;
          const view = rec.payload as TableView;
          if (view.hand?.handNumber !== hand) continue;
          // Before a showdown, opponents' cards never leave the server.
          const revealed = !!view.hand.result?.wentToShowdown;
          for (const [owner, own] of cards) {
            if (owner === viewer.id || revealed) continue;
            for (const card of own) expect(rec.raw, `${viewer.session.me.name} saw ${owner}'s card`).not.toContain(cardJson(card));
          }
          if (!revealed) {
            const mine = viewer === c ? 0 : 2;
            expect(countCards(rec.raw)).toBeLessThanOrEqual(mine + view.hand.board.length);
          }
          for (const seat of view.seats) {
            if (!seat.player || seat.player.id === viewer.id || revealed) continue;
            expect(seat.player.holeCards).toBeNull();
          }
        }
      }
    }

    // --- history: /me/hands shows your own cards and only what was tabled
    // (hands are recorded off the table's queue, so wait for the last one to land)
    await server.app.realtime.rooms.get(room)!.currentTable!.settled();
    const hands = await http<HandHistoryView[]>(server, '/me/hands', { token: a.token });
    expect(hands.status).toBe(200);
    const byNumber = new Map(hands.body.map((h) => [h.handNumber, h]));
    expect([...byNumber.keys()]).toEqual(expect.arrayContaining([1, 2, 3]));
    const h1 = byNumber.get(1)!;
    expect(h1.players.find((p) => p.id === a.id)!.cards).toEqual(holeCards(a, 1));
    // Card backs are stored per hand, so face-down cards can be drawn as played.
    expect(h1.players.map((p) => p.cardBack)).toEqual(h1.players.map(() => 'back-classic'));
    expect(h1.players.find((p) => p.id === b.id)!.cards).toBeNull();
    expect(JSON.stringify(h1)).not.toContain(cardJson(holeCards(b, 1)[0]));
    const h2 = byNumber.get(2)!;
    expect(h2.players.find((p) => p.id === b.id)!.cards).toEqual(holeCards(b, 2));
    const cHands = await http<HandHistoryView[]>(server, '/me/hands', { token: c.token });
    expect(cHands.body).toEqual([]);

    const stats = await http<{ summary: { handsPlayed: number } }>(server, `/players/${a.id}/stats`, { token: c.token });
    expect(stats.body.summary.handsPlayed).toBeGreaterThanOrEqual(3);

    // --- leave: queued until the hand ends, then cashed out; the table closes when the players are gone
    const aLeft = a.next('table_left', undefined, { since: a.mark(), timeout: 8000 });
    const bLeft = b.next('table_left', undefined, { since: b.mark(), timeout: 8000 });
    const cLeft = c.next('table_left', undefined, { since: c.mark(), timeout: 8000 });
    expect(await a.send('leave_table')).toEqual({ ok: true });
    expect(await b.send('leave_table')).toEqual({ ok: true });
    await driveUntil([a, b], () => a.latest('table_left') !== undefined && b.latest('table_left') !== undefined);
    expect(await aLeft).toEqual({ code: 'left', reason: 'You left the table.' });
    expect(await bLeft).toEqual({ code: 'left', reason: 'You left the table.' });
    expect(await cLeft).toEqual({ code: 'abandoned', reason: 'Everyone left the table.' });
    await c.state('lobby_state', (s) => s.table === null);

    // Nothing is left in escrow and no chips were created or lost.
    expect(await server.services.bank.escrowed(a.id)).toBe(0);
    expect(await server.services.bank.escrowed(b.id)).toBe(0);
    const [balA, balB] = [await balance(a), await balance(b)];
    expect(balA + balB).toBe(20_000 + (await minted([a.id, b.id])));
    expect(Math.abs(balA - 10_000)).toBeLessThan(1000);
    await a.state('me', (m) => m.balance === balA);
    await b.state('me', (m) => m.balance === balB);
    expect(await c.send('watch_table')).toEqual({ ok: false, error: 'There is no table open.' });
    for (const x of [a, b, c]) x.close();
  });

  it('resends the table, hole cards included, to a player who reconnects mid-hand', async () => {
    const a = await player(server, 'Stays');
    const b = await player(server, 'Drops');
    const room = await openAndSeat(a, [b], [a, b]);
    expect(await a.send('start_table')).toEqual({ ok: true });
    await waitOn([a, b], () => actor([a, b]), 'the first turn');
    const before = await b.state('table_state', (v) => !!v.seats[1].player?.holeCards);
    const cards = before.seats[1].player!.holeCards;

    b.close();
    await a.state('table_state', (v) => v.seats[1].player?.connected === false);
    await a.state('lobby_state', (s) => !s.members.some((m) => m.id === b.id));

    const again = await connect(server, b.session);
    expect(await again.send('join_room', { instanceId: room })).toEqual({ ok: true });
    const view = await again.state('table_state', () => true);
    expect(view.hand?.handNumber).toBe(before.hand!.handNumber);
    expect(view.you).toMatchObject({ role: 'seated', seat: 1 });
    expect(view.seats[1].player!.holeCards).toEqual(cards);
    expect(view.seats[0].player!.holeCards).toBeNull();
    await a.state('table_state', (v) => v.seats[1].player?.connected === true);

    // An explicit refresh sends the same view again.
    const mark = again.mark();
    again.socket.emit('request_state');
    expect((await again.next('table_state', undefined, { since: mark })).seats[1].player!.holeCards).toEqual(cards);
    a.close();
    again.close();
  });

  it('returns the buy-in when a player leaves before the game starts', async () => {
    const host = await player(server, 'Opener');
    const guest = await player(server, 'Leaver');
    await openAndSeat(host, [guest], [host, guest], 3000);
    await guest.state('me', (m) => m.balance === 7000);

    const since = guest.mark();
    expect(await guest.send('leave_table')).toEqual({ ok: true });
    expect(await guest.next('table_left', undefined, { since })).toEqual({ code: 'left', reason: 'You left the table.' });
    expect(await balance(guest)).toBe(10_000);
    await guest.state('me', (m) => m.balance === 10_000);
    await host.state('table_state', (v) => v.seats[1].player === null);
    await host.state('lobby_state', (s) => s.members.find((m) => m.id === guest.id)?.presence === 'lobby');

    // Last one out closes the table.
    const hostSince = host.mark();
    expect(await host.send('leave_table')).toEqual({ ok: true });
    await host.next('table_left', undefined, { since: hostSince });
    await host.state('lobby_state', (s) => s.table === null);
    expect(await balance(host)).toBe(10_000);
    host.close();
    guest.close();
  });

  it('handles a double-tapped take_seat from someone not yet at the table', async () => {
    const host = await player(server, 'Dbl host');
    const guest = await player(server, 'Dbl guest');
    await openAndSeat(host, [guest], []);
    // Both commands arrive before either finishes; only one may buy in.
    const acks = await Promise.all([
      guest.send('take_seat', { seat: 1, buyIn: 2000 }),
      guest.send('take_seat', { seat: 2, buyIn: 2000 }),
    ]);
    expect(acks).toEqual([{ ok: true }, { ok: false, error: "You're already seated." }]);
    const view = await host.state('table_state', (v) => v.seats.some((s) => s.player?.id === guest.id));
    expect(view.seats.filter((s) => s.player?.id === guest.id)).toHaveLength(1);
    expect(await balance(guest)).toBe(8000);
    expect(await server.services.bank.escrowed(guest.id)).toBe(2000);
    await guest.state('table_state', (v) => v.you.role === 'seated');
    host.close();
    guest.close();
  });

  it('refuses a buy-in the bankroll cannot cover', async () => {
    const host = await player(server, 'Rich');
    const poor = await player(server, 'Poor');
    for (const [itemId, nonce] of [['felt-oxblood', 'nonce-poor-felt'], ['back-navy', 'nonce-poor-back']]) {
      expect((await http(server, '/shop/purchase', { token: poor.token, body: { itemId, nonce } })).status).toBe(200);
    }
    expect(await balance(poor)).toBe(3000);
    await openAndSeat(host, [poor], []);
    expect(await poor.send('take_seat', { seat: 1, buyIn: 4000 }))
      .toEqual({ ok: false, error: "You don't have enough chips for that buy-in." });
    expect(await balance(poor)).toBe(3000);
    await poor.state('table_state', (v) => v.you.role === 'spectator' && v.seats[1].player === null);
    expect(await poor.send('take_seat', { seat: 1, buyIn: 3000 })).toEqual({ ok: true });
    expect(await balance(poor)).toBe(0);
    host.close();
    poor.close();
  });
});

describe('table effects', () => {
  it('broadcasts emotes and throwables to the room', async () => {
    const a = await player(server, 'Thrower');
    const b = await player(server, 'Target');
    const lobbyOnly = await player(server, 'Bystander');
    await openAndSeat(a, [b], [b]);
    await joinAll([lobbyOnly], a.latest('lobby_state')!.instanceId);

    // Emotes need table membership and an owned emote.
    expect(await lobbyOnly.send('emote', { emote: '👍' })).toEqual({ ok: false, error: 'Join the table first.' });
    const view = await a.state('table_state', (v) => v.you.emotes.length > 0);
    expect(await a.send('emote', { emote: 'not-an-emote' })).toEqual({ ok: false, error: "You don't own that emote." });
    const marks = [a, b, lobbyOnly].map((x) => x.mark());
    expect(await a.send('emote', { emote: view.you.emotes[0] })).toEqual({ ok: true });
    for (const [i, x] of [a, b, lobbyOnly].entries()) {
      const fx = await x.next('table_fx', (f) => f.kind === 'emote', { since: marks[i] });
      expect(fx).toMatchObject({ kind: 'emote', fromId: a.id, value: view.you.emotes[0] });
    }

    // Throwables are bought, then thrown at someone seated.
    expect(await a.send('throw_item', { itemId: 'throw-tomato', targetId: b.id })).toMatchObject({ ok: false, error: expect.stringContaining('out of') });
    const buy = await http(server, '/shop/purchase', { token: a.token, body: { itemId: 'throw-tomato', nonce: 'nonce-tomatoes-1' } });
    expect(buy.status).toBe(200);
    await a.state('me', (m) => m.owned['throw-tomato'] === 5);
    expect(await a.send('throw_item', { itemId: 'throw-tomato', targetId: lobbyOnly.id })).toEqual({ ok: false, error: 'Pick someone seated at the table.' });
    expect(await a.send('throw_item', { itemId: 'felt-classic', targetId: b.id })).toEqual({ ok: false, error: "That can't be thrown." });
    const throwMarks = [a, b].map((x) => x.mark());
    expect(await a.send('throw_item', { itemId: 'throw-tomato', targetId: b.id })).toEqual({ ok: true });
    for (const [i, x] of [a, b].entries()) {
      const fx = await x.next('table_fx', (f) => f.kind === 'throw', { since: throwMarks[i] });
      expect(fx).toMatchObject({ kind: 'throw', fromId: a.id, toId: b.id, value: 'throw-tomato' });
    }
    await a.state('me', (m) => m.owned['throw-tomato'] === 4);
    for (const x of [a, b, lobbyOnly]) x.close();
  });
});
