import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Card, TableView } from '@poker/shared';
import { FAST } from '../table-harness.js';
import { useTestDb } from '../db.js';
import { actor, joinAll, player, startServer, waitOn, type TestClient, type TestServer, uniqueRoom } from './helpers.js';

const t = useTestDb();
let server: TestServer;

beforeAll(async () => {
  // A fold-out result stays up long enough to show cards during it.
  server = await startServer(t.db, { timing: { ...FAST, foldWinMs: 60_000 } });
});
afterAll(async () => {
  await server?.close();
});

const RULES = { name: 'Show table', smallBlind: 25, bigBlind: 50, minBuyIn: 1000, maxBuyIn: 5000, maxSeats: 6 };
const cardJson = (c: Card) => JSON.stringify(c);
const ownCards = (x: TestClient): Card[] => {
  const v = x.table!;
  return v.seats[v.you.seat!].player!.holeCards!;
};
const seatOf = (v: TableView, id: string) => v.seats.find((s) => s.player?.id === id)!.player!;

describe('showing cards over sockets', () => {
  it('validates the payload, keeps a mid-hand choice private, and shows a fold-out winner on request', { timeout: 20_000 }, async () => {
    const a = await player(server, 'Shower');
    const b = await player(server, 'Folder');
    const c = await player(server, 'Rail');
    await joinAll([a, b, c], uniqueRoom('inst-show'));
    expect(await a.send('open_table', { rules: RULES })).toEqual({ ok: true });
    expect(await c.send('watch_table')).toEqual({ ok: true });
    expect(await a.send('take_seat', { seat: 0, buyIn: 2000 })).toEqual({ ok: true });
    expect(await b.send('take_seat', { seat: 1, buyIn: 2000 })).toEqual({ ok: true });
    expect(await a.send('start_table')).toEqual({ ok: true });

    const folder = await waitOn([a, b], () => actor([a, b]), 'the first turn');
    const winner = folder === a ? b : a;
    const hand = folder.table!.hand!.handNumber;
    await winner.state('table_state', (v) => v.hand?.handNumber === hand && !!seatOf(v, winner.id).holeCards);
    const folderCards = ownCards(folder);
    const winnerCards = ownCards(winner);

    // --- payloads are validated field by field
    expect(await winner.raw('show_cards', { show: 'yes' })).toEqual({ ok: false, error: 'Choose whether to show your cards.' });
    expect(await winner.raw('show_cards', {})).toEqual({ ok: false, error: 'Choose whether to show your cards.' });
    expect(await winner.raw('show_cards', null)).toEqual({ ok: false, error: 'Choose whether to show your cards.' });
    for (const bad of ['7', null, 1.5, {}, 0, -1]) {
      expect(await winner.raw('show_cards', { show: true, handNumber: bad })).toEqual({ ok: false, error: "That isn't a valid hand number." });
    }
    expect(await winner.send('show_cards', { show: true, handNumber: hand + 1 })).toEqual({ ok: false, error: 'That hand has already moved on.' });
    expect(await c.send('show_cards', { show: true })).toEqual({ ok: false, error: "You weren't dealt into this hand." });

    // --- the folder pre-selects mid-hand: only their own view changes
    const wMark = winner.mark();
    const cMark = c.mark();
    expect(await folder.send('show_cards', { show: true, handNumber: hand })).toEqual({ ok: true });
    await folder.state('table_state', (v) => v.you.showCards);
    expect(await folder.send('act', { type: 'fold' })).toEqual({ ok: true });

    // The fold's broadcast is the sentinel: nothing reached the others before it.
    const wResult = await winner.next('table_state', (v) => !!v.hand?.result, { since: wMark });
    await c.next('table_state', (v) => !!v.hand?.result, { since: cMark });
    for (const [x, since] of [[winner, wMark], [c, cMark]] as const) {
      const states = x.log.slice(since).filter((r) => r.event === 'table_state');
      const firstResult = states.findIndex((r) => !!(r.payload as TableView).hand?.result);
      for (const r of states.slice(0, firstResult)) {
        expect((r.payload as TableView).you.showCards).toBe(false);
        for (const card of folderCards) expect(r.raw).not.toContain(cardJson(card));
      }
    }
    expect(wResult.hand!.result!.wentToShowdown).toBe(false);
    // Once the hand is over the folder's choice takes effect for everyone.
    expect(seatOf(wResult, folder.id)).toMatchObject({ folded: true, revealed: true, holeCards: folderCards });
    expect(seatOf(wResult, winner.id)).toMatchObject({ revealed: false });

    // --- the fold-out winner shows their cards during the result
    const fMark = folder.mark();
    expect(await winner.send('show_cards', { show: true, handNumber: hand })).toEqual({ ok: true });
    const seen = await folder.next('table_state', (v) => seatOf(v, winner.id).revealed, { since: fMark });
    expect(seatOf(seen, winner.id)).toMatchObject({ holeCards: winnerCards, hasHiddenCards: false });
    await c.state('table_state', (v) => seatOf(v, winner.id).revealed && !!seatOf(v, winner.id).holeCards);

    // --- and can hide them again
    expect(await winner.send('show_cards', { show: false, handNumber: hand })).toEqual({ ok: true });
    const hidden = await folder.state('table_state', (v) => !seatOf(v, winner.id).revealed);
    expect(seatOf(hidden, winner.id)).toMatchObject({ holeCards: null, hasHiddenCards: true });
  });
});
