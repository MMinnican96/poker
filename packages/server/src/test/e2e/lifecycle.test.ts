import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDb } from '../db.js';
import { actor, joinAll, player, startServer, waitOn, type TestClient, type TestServer, uniqueRoom } from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  server = await startServer(t.db);
});
afterAll(async () => {
  await server?.close();
});

const newRoom = () => uniqueRoom('inst-life');
const RULES = { name: 'Lifecycle', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, maxSeats: 6 };

/** Emit request_state and resolve with whichever of table_state / table_left answers it. */
async function requestState(c: TestClient) {
  const since = c.mark();
  c.socket.emit('request_state');
  return waitOn([c], () => {
    const r = c.log.slice(since).find((e) => e.event === 'table_state' || e.event === 'table_left');
    return r ? { event: r.event, payload: r.payload } : undefined;
  }, 'an answer to request_state');
}

describe('request_state', () => {
  it('tells a socket with no table (or no room) that it is not at one', async () => {
    const a = await player(server, 'Roomless');
    expect(await requestState(a)).toEqual({
      event: 'table_left',
      payload: { code: 'not-member', reason: "You're no longer at the table." },
    });
    await joinAll([a], newRoom());
    expect(await requestState(a)).toMatchObject({ event: 'table_left', payload: { code: 'not-member' } });
    a.close();
  });

  it('answers a member with the table and a non-member with table_left', async () => {
    const room = newRoom();
    const host = await player(server, 'Rs host');
    const other = await player(server, 'Rs other');
    await joinAll([host, other], room);
    expect(await host.send('open_table', { rules: RULES })).toEqual({ ok: true });
    await other.state('lobby_state', (s) => s.table !== null);

    expect(await requestState(host)).toMatchObject({ event: 'table_state', payload: { you: { id: host.id } } });
    expect(await requestState(other)).toMatchObject({ event: 'table_left', payload: { code: 'not-member' } });

    // Once they watch, they get the table instead.
    expect(await other.send('watch_table')).toEqual({ ok: true });
    expect(await requestState(other)).toMatchObject({ event: 'table_state', payload: { you: { role: 'spectator' } } });
    host.close();
    other.close();
  });
});

describe('table_left codes', () => {
  it('tells everyone at the table the host closed it', async () => {
    const room = newRoom();
    const host = await player(server, 'Closer');
    const guest = await player(server, 'Closed on');
    const rail = await player(server, 'Rail');
    await joinAll([host, guest, rail], room);
    expect(await host.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await guest.send('take_seat', { seat: 1, buyIn: 2000 })).toEqual({ ok: true });
    expect(await rail.send('watch_table')).toEqual({ ok: true });

    const marks = [host, guest, rail].map((c) => c.mark());
    expect(await host.send('close_table')).toEqual({ ok: true });
    for (const [i, c] of [host, guest, rail].entries()) {
      expect(await c.next('table_left', undefined, { since: marks[i] }))
        .toEqual({ code: 'host-closed', reason: 'The host closed the table.' });
    }
    await guest.state('me', (m) => m.balance === 10_000);
    for (const c of [host, guest, rail]) c.close();
  });
});

describe('app.close()', () => {
  it('cashes out every table and tells its members before closing sockets', async () => {
    const own = await startServer(t.db);
    const a = await player(own, 'Shut a');
    const b = await player(own, 'Shut b');
    await joinAll([a, b], newRoom());
    expect(await a.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await a.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: true });
    expect(await b.send('take_seat', { seat: 1, buyIn: 3000 })).toEqual({ ok: true });
    expect(await a.send('start_table')).toEqual({ ok: true });
    await waitOn([a, b], () => actor([a, b]), 'the first turn');

    const [ma, mb] = [a.mark(), b.mark()];
    await own.app.close();
    for (const [c, since] of [[a, ma], [b, mb]] as const) {
      await c.next('table_left', undefined, { since });
      expect(c.all('table_left', since)).toEqual([
        { code: 'shutdown', reason: 'The server is restarting. Your chips are back in your bankroll.' },
      ]);
    }
    for (const c of [a, b]) {
      expect(await own.services.bank.escrowed(c.id)).toBe(0);
      expect(await own.services.bank.balance(c.id)).toBe(10_000);
    }
    // Closing again is harmless.
    await own.app.close();
    a.close();
    b.close();
  });
});

describe('turn deadline', () => {
  it('sends when the turn started with its deadline', async () => {
    const room = newRoom();
    const a = await player(server, 'Clock a');
    const b = await player(server, 'Clock b');
    await joinAll([a, b], room);
    expect(await a.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await a.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: true });
    expect(await b.send('take_seat', { seat: 1, buyIn: 2000 })).toEqual({ ok: true });
    expect(await a.send('start_table')).toEqual({ ok: true });
    await waitOn([a, b], () => actor([a, b]), 'the first turn');
    const hand = a.table!.hand!;
    expect(hand.actionStartedAt).toEqual(expect.any(Number));
    // The e2e server's turn timer is 60 s (FAST timing).
    expect(hand.actionEndsAt! - hand.actionStartedAt!).toBe(60_000);
    a.close();
    b.close();
  });
});
