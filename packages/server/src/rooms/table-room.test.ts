import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type TableRules } from '@poker/shared';
import { getPlayerRow, toPublic } from '../services/players.js';
import { useTestDb } from '../test/db.js';
import { Harness, waitFor } from '../test/table-harness.js';

const t = useTestDb();
let harness: Harness | null = null;
afterEach(() => {
  harness?.table.dispose();
  harness = null;
});

async function setup(count: number, opts?: Parameters<typeof Harness.create>[2]) {
  harness = await Harness.create(t.db, count, opts);
  return harness;
}

describe('seating and buy-ins', () => {
  it('moves the buy-in into escrow and validates seats and amounts', async () => {
    const h = await setup(3);
    expect(await h.seat(0, 0, 2000)).toEqual({ ok: true });
    expect(await h.balance(0)).toBe(8000);
    expect(await h.seat(1, 0, 2000)).toEqual({ ok: false, error: 'That seat is taken.' });
    expect(await h.seat(1, 9, 2000)).toMatchObject({ ok: false, error: 'That seat does not exist.' });
    expect(await h.seat(1, 1, 999)).toMatchObject({ ok: false });
    expect(await h.seat(1, 1, 5001)).toMatchObject({ ok: false });
    expect(await h.seat(0, 2, 2000)).toEqual({ ok: false, error: "You're already seated." });
    expect(await h.services.bank.escrowed(h.ids[0])).toBe(2000);
    expect(h.view(0).seats[0].player).toMatchObject({ id: h.ids[0], stack: 2000 });
  });

  it('refuses a buy-in the bankroll cannot cover and frees the seat', async () => {
    const h = await setup(2, { rules: { maxBuyIn: 25_000, minBuyIn: 1000, smallBlind: 50, bigBlind: 100 } });
    expect(await h.seat(1, 1, 20_000)).toMatchObject({ ok: false, error: "You don't have enough chips for that buy-in." });
    expect(h.view(1).seats[1].player).toBeNull();
    expect(await h.seat(1, 1, 5000)).toEqual({ ok: true });
  });

  it('only lets the host start, and only with two players', async () => {
    const h = await setup(2);
    await h.seat(0);
    expect(h.table.start(h.ids[0])).toMatchObject({ ok: false, error: 'At least two players need to be seated.' });
    await h.seat(1);
    expect(h.table.start(h.ids[1])).toMatchObject({ ok: false, error: 'Only the host can start the game.' });
    expect(h.table.start(h.ids[0])).toEqual({ ok: true });
    await waitFor(() => h.toAct() !== null, 3000, 'first hand');
  });
});

describe('dealing and privacy', () => {
  it('shows players only their own cards and spectators none', async () => {
    const h = await setup(3);
    await h.seat(0);
    await h.seat(1);
    await h.join(2);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    const mine = h.view(0).seats[0].player!;
    const theirs = h.view(0).seats[1].player!;
    expect(mine.holeCards).toHaveLength(2);
    expect(theirs.holeCards).toBeNull();
    expect(theirs.hasHiddenCards).toBe(true);
    const spectator = h.view(2);
    expect(spectator.seats[0].player!.holeCards).toBeNull();
    expect(spectator.seats[1].player!.holeCards).toBeNull();
    expect(spectator.you.role).toBe('spectator');
    expect(spectator.you.legal).toBeNull();
  });

  it('gives legal actions only to the player to act and rejects others', async () => {
    const h = await setup(2);
    await h.seat(0);
    await h.seat(1);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    const actor = h.toAct()!;
    const other = h.ids.find((id) => id !== actor)!;
    expect(h.table.viewFor(actor).you.legal).not.toBeNull();
    expect(h.table.viewFor(other).you.legal).toBeNull();
    expect(h.table.act(other, { type: 'fold' })).toMatchObject({ ok: false });
  });
});

describe('the chip lifecycle', () => {
  it('conserves chips across many hands, checkpointing escrow and recording stats', async () => {
    const h = await setup(4, { seed: 99 });
    for (let i = 0; i < 4; i++) await h.seat(i, i, 1000 + i * 500);
    const before = await h.chipsInPlay();
    h.table.start(h.ids[0]);

    let actions = 0;
    let seed = 1;
    const funded = () => h.view(0).seats.filter((s) => s.player && s.player.stack > 0 && !s.player.inHand).length;
    const idle = () => !h.view(0).hand && funded() < 2;
    while (h.view(0).handsDealt < 12 && actions < 2000) {
      await waitFor(() => h.toAct() !== null || h.closed || idle(), 3000, 'a turn');
      if (h.closed || h.toAct() === null) break;
      const id = h.toAct()!;
      const legal = h.table.viewFor(id).you.legal!;
      seed = (seed * 16807) % 2147483647;
      const roll = seed % 10;
      const action = roll < 2 ? { type: 'fold' as const }
        : roll < 3 ? { type: 'all-in' as const }
        : roll < 5 && legal.canRaise ? { type: 'raise' as const, amount: legal.minRaiseTo }
        : { type: legal.canCheck ? 'check' as const : 'call' as const };
      expect(h.table.act(id, action)).toEqual({ ok: true });
      actions++;
    }
    expect(h.view(0).handsDealt).toBeGreaterThanOrEqual(3);
    await h.table.close(h.ids[0]);
    await waitFor(() => h.closed, 5000, 'table close');
    await h.table.settled();

    // Everyone cashed out: no escrow left, and no chip created or destroyed.
    for (const id of h.ids) expect(await h.services.bank.escrowed(id)).toBe(0);
    expect(await h.chipsInPlay()).toBe(before);
    const stats = await h.services.stats.summary(h.ids[0]);
    expect(stats.handsPlayed).toBeGreaterThan(0);
  });

  it('checkpoints stacks to escrow after each hand', async () => {
    const h = await setup(2);
    await h.seat(0, 0, 2000);
    await h.seat(1, 1, 2000);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    h.table.act(h.toAct()!, { type: 'fold' });
    await waitFor(() => h.view(0).handsDealt === 2 && h.toAct() !== null, 3000, 'second hand');
    const e0 = await h.services.bank.escrowed(h.ids[0]);
    const e1 = await h.services.bank.escrowed(h.ids[1]);
    expect(e0 + e1).toBe(4000);
    expect(new Set([e0, e1])).toEqual(new Set([1975, 2025]));
  });
});

describe('leaving, standing and busting', () => {
  it('defers leaving until the hand ends, then cashes out', async () => {
    const h = await setup(3);
    await h.seat(0);
    await h.seat(1);
    await h.seat(2);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    const leaver = h.ids[1];
    expect(await h.table.leave(leaver)).toEqual({ ok: true });
    expect(h.table.viewFor(leaver).you.pending).toBe('leave');
    expect(h.left).toHaveLength(0);
    // Finish the hand: everyone folds to one player.
    while (h.view(0).handsDealt === 1) {
      await waitFor(() => h.toAct() !== null || h.view(0).handsDealt > 1, 3000);
      const id = h.toAct();
      if (id) h.table.act(id, { type: 'fold' });
    }
    await waitFor(() => h.left.some((l) => l.playerId === leaver), 3000, 'leave');
    expect(h.table.isMember(leaver)).toBe(false);
    expect(await h.services.bank.escrowed(leaver)).toBe(0);
    const bal = await h.services.bank.balance(leaver);
    expect(bal).toBeGreaterThanOrEqual(10_000 - 50);
  });

  it('stands up immediately between hands and keeps watching', async () => {
    const h = await setup(2);
    await h.seat(0);
    expect(await h.table.standUp(h.ids[0])).toEqual({ ok: true });
    expect(await h.balance(0)).toBe(10_000);
    expect(h.table.roleOf(h.ids[0])).toBe('spectator');
  });

  it('moves a busted player to watching with a nudge', async () => {
    const h = await setup(2, { rules: { minBuyIn: 500, maxBuyIn: 5000 } });
    await h.seat(0, 0, 5000);
    await h.seat(1, 1, 500);
    h.table.start(h.ids[0]);
    // Both shove until someone busts.
    await waitFor(async () => {
      const id = h.toAct();
      if (id) h.table.act(id, { type: 'all-in' });
      return h.notices.some((n) => n.notice.title === "You're out of chips") || h.closed;
    }, 8000, 'a bust');
    const busted = h.notices.find((n) => n.notice.title === "You're out of chips")!.playerId;
    await waitFor(() => h.table.roleOf(busted) === 'spectator');
    expect(await h.services.bank.escrowed(busted)).toBe(0);
  });

  it('hands the host role on when the host leaves, and closes when everyone has gone', async () => {
    const h = await setup(2);
    await h.join(1);
    await h.table.leave(h.ids[0]);
    expect(h.table.host).toBe(h.ids[1]);
    expect(h.notices.some((n) => n.playerId === h.ids[1] && n.notice.title === "You're the host now")).toBe(true);
    await h.table.leave(h.ids[1]);
    await waitFor(() => h.closed);
  });
});

describe('timers and disconnects', () => {
  it('auto-folds on timeout and sits a player out after two misses', async () => {
    const h = await setup(2, { timing: { turnMs: 30 } });
    await h.seat(0);
    await h.seat(1);
    h.table.start(h.ids[0]);
    await waitFor(() => h.notices.some((n) => n.notice.title === "You've been sat out"), 5000, 'sit-out');
    const out = h.notices.find((n) => n.notice.title === "You've been sat out")!.playerId;
    expect(h.table.viewFor(out).you.sittingOut).toBe(true);
    expect(h.table.setSittingOut(out, false)).toEqual({ ok: true });
  });

  it('sits out and then stands up a player who disconnects', async () => {
    const h = await setup(2);
    await h.seat(0);
    await h.seat(1);
    h.table.disconnect(h.ids[1]);
    await waitFor(() => h.left.some((l) => l.playerId === h.ids[1]), 3000, 'stand-up after disconnect');
    expect(await h.services.bank.escrowed(h.ids[1])).toBe(0);
    expect(await h.balance(1)).toBe(10_000);
  });
});

describe('top-ups and host controls', () => {
  it('queues a top-up during a hand and applies it at the boundary', async () => {
    const h = await setup(2);
    await h.seat(0, 0, 1000);
    await h.seat(1, 1, 1000);
    expect(await h.table.topUp(h.ids[0], 4001)).toMatchObject({ ok: false });
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    expect(await h.table.topUp(h.ids[0], 500)).toEqual({ ok: true });
    expect(h.table.viewFor(h.ids[0]).you.pendingTopUp).toBe(500);
    h.table.act(h.toAct()!, { type: 'fold' });
    await waitFor(() => h.table.viewFor(h.ids[0]).you.pendingTopUp === 0 && h.view(0).handsDealt >= 2, 3000, 'top-up');
    expect(await h.balance(0)).toBe(10_000 - 1500);
  });

  it('locks rules once running and validates changes', async () => {
    const h = await setup(2);
    expect(await h.table.updateRules(h.ids[0], { turnSeconds: 45 })).toEqual({ ok: true });
    expect(await h.table.updateRules(h.ids[0], { turnSeconds: 7 })).toMatchObject({ ok: false });
    expect(await h.table.updateRules(h.ids[1], { turnSeconds: 45 })).toMatchObject({ ok: false });
    await h.seat(0, 5);
    expect(await h.table.updateRules(h.ids[0], { maxSeats: 4 })).toMatchObject({ ok: false });
    await h.seat(1, 1);
    h.table.start(h.ids[0]);
    expect(await h.table.updateRules(h.ids[0], { turnSeconds: 60 })).toMatchObject({ ok: false });
  });

  it("only lets the host switch to a felt they own, and keeps only known rule fields", async () => {
    const h = await setup(1);
    expect(await h.table.updateRules(h.ids[0], { feltId: 'felt-oxblood' })).toEqual({ ok: false, error: "You don't own that felt." });
    expect(h.view(0).rules.feltId).toBe('felt-classic');
    await h.services.bank.credit({ playerId: h.ids[0], amount: 10_000, type: 'grant', key: `felt:${h.ids[0]}` });
    expect(await h.services.shop.purchase(h.ids[0], 'felt-oxblood', 'nonce-felt0001')).toMatchObject({ ok: true });
    const patch = { feltId: 'felt-oxblood', evil: '<script>' } as unknown as Partial<TableRules>;
    expect(await h.table.updateRules(h.ids[0], patch)).toEqual({ ok: true });
    expect(h.view(0).rules.feltId).toBe('felt-oxblood');
    expect(Object.keys(h.view(0).rules).sort()).toEqual(Object.keys(DEFAULT_RULES).sort());
  });

  it('closes after the current hand and cashes everyone out', async () => {
    const h = await setup(2);
    await h.seat(0);
    await h.seat(1);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    await h.table.close(h.ids[0]);
    expect(h.view(0).closing).toBe(true);
    expect(h.closed).toBe(false);
    h.table.act(h.toAct()!, { type: 'fold' });
    await waitFor(() => h.closed, 3000, 'close');
    await h.table.settled();
    expect((await h.balance(0)) + (await h.balance(1))).toBe(20_000);
  });
});

describe('emotes and throwables', () => {
  it('allows owned emotes and consumes throwables', async () => {
    const h = await setup(2);
    await h.seat(1);
    expect(await h.table.emote(h.ids[0], '👍')).toEqual({ ok: true });
    expect(await h.table.emote(h.ids[0], '🐀')).toMatchObject({ ok: false });
    expect(await h.table.throwItem(h.ids[0], 'throw-tomato', h.ids[1])).toMatchObject({ ok: false });
    await h.services.shop.purchase(h.ids[0], 'throw-tomato', 'nonce-abcdef12');
    expect(await h.table.throwItem(h.ids[0], 'throw-tomato', h.ids[1])).toEqual({ ok: true });
    expect((await h.services.shop.owned(h.ids[0]))['throw-tomato']).toBe(4);
    expect(h.fx).toHaveLength(2);
  });
});

/** Make a bank method take `ms` longer, to widen race windows. */
function slow<K extends 'buyIn' | 'topUp' | 'cashOut'>(h: Harness, method: K, ms = 30): void {
  const bank = h.services.bank as unknown as Record<K, (input: unknown) => Promise<unknown>>;
  const original = bank[method].bind(h.services.bank);
  bank[method] = async (input: unknown) => {
    await new Promise((r) => setTimeout(r, ms));
    return original(input);
  };
}

/** The dealt-in engine players of the current hand (id -> stack + committed). */
function dealt(h: Harness): Map<string, number> {
  const hand = (h.table as unknown as { hand: { state: { players: { id: string; stack: number; total: number }[] } } | null }).hand;
  return new Map((hand?.state.players ?? []).map((p) => [p.id, p.stack + p.total]));
}

describe('bank operations racing the deal', () => {
  it('deals a player whose top-up is in flight with the topped-up stack, losing no chips', async () => {
    const h = await setup(2);
    await h.seat(0, 0, 2000);
    await h.seat(1, 1, 2000);
    const before = await h.chipsInPlay();
    slow(h, 'topUp');
    const topUp = h.table.topUp(h.ids[0], 1000);
    h.table.start(h.ids[0]); // the deal timer fires while the top-up is still in the bank
    expect(await topUp).toEqual({ ok: true });
    await waitFor(() => h.toAct() !== null);
    expect(dealt(h).get(h.ids[0])).toBe(3000);
    h.table.act(h.toAct()!, { type: 'fold' });
    await waitFor(() => h.view(0).handsDealt >= 2 && h.toAct() !== null, 3000, 'second hand');
    await h.table.settled();
    expect(await h.chipsInPlay()).toBe(before);
    expect((await h.services.bank.escrowed(h.ids[0])) + (await h.services.bank.escrowed(h.ids[1]))).toBe(5000);
  });

  for (const how of ['standUp', 'leave'] as const) {
    it(`never deals in a player whose ${how} cash-out is in flight`, async () => {
      const h = await setup(3);
      await h.seat(0, 0, 2000);
      await h.seat(1, 1, 2000);
      await h.seat(2, 2, 2000);
      const before = await h.chipsInPlay();
      slow(h, 'cashOut');
      const going = h.table[how](h.ids[2]);
      h.table.start(h.ids[0]);
      expect(await going).toEqual({ ok: true });
      await waitFor(() => h.toAct() !== null);
      expect(dealt(h).has(h.ids[2])).toBe(false);
      expect(await h.balance(2)).toBe(10_000);
      expect(await h.services.bank.escrowed(h.ids[2])).toBe(0);
      while (h.toAct()) h.table.act(h.toAct()!, { type: 'fold' });
      await waitFor(() => h.view(0).handsDealt >= 2, 3000, 'second hand');
      await h.table.settled();
      expect(await h.chipsInPlay()).toBe(before);
    });
  }

  it('a stand-up requested while a deal is queued waits for that hand', async () => {
    const h = await setup(2);
    await h.seat(0, 0, 2000);
    await h.seat(1, 1, 2000);
    slow(h, 'topUp', 40);
    const topUp = h.table.topUp(h.ids[0], 100); // holds the queue
    h.table.start(h.ids[0]);
    await new Promise((r) => setTimeout(r, 10)); // the deal is now queued behind the top-up
    const stand = h.table.standUp(h.ids[1]);
    await topUp;
    expect(await stand).toEqual({ ok: true });
    // The deal ran first, so the stand-up waits for the hand instead of cashing out mid-hand.
    expect(dealt(h).has(h.ids[1])).toBe(true);
    expect(h.table.viewFor(h.ids[1]).you.pending).toBe('stand');
    expect(await h.services.bank.escrowed(h.ids[1])).toBe(2000);
  });
});

describe('membership races', () => {
  it('a double take-seat from a non-member seats them once and strands nothing', async () => {
    const h = await setup(2);
    const id = h.ids[1];
    const me = toPublic((await getPlayerRow(t.db, id))!);
    // Each emote lookup is slower than the last, so the second join straddles the first buy-in.
    const shop = h.services.shop as unknown as { owned: (id: string) => Promise<Record<string, number>> };
    const owned = shop.owned.bind(h.services.shop);
    let calls = 0;
    shop.owned = async (pid: string) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, calls * 40));
      return owned(pid);
    };
    // What the socket handler does, twice at once (e.g. a double tap on two sockets).
    const go = async () => {
      if (!h.table.isMember(id)) await h.table.watch(me);
      return h.table.takeSeat(id, 1, 2000);
    };
    const results = await Promise.all([go(), go()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(h.table.roleOf(id)).toBe('seated');
    expect(h.view(1).seats[1].player?.id).toBe(id);
    expect(await h.balance(1)).toBe(8000);
    expect(await h.services.bank.escrowed(id)).toBe(2000);
    expect(await h.table.standUp(id)).toEqual({ ok: true });
    expect(await h.balance(1)).toBe(10_000);
  });

  it('keeps a buy-in on the books when the player disconnects while it is in flight', async () => {
    const h = await setup(2);
    await h.join(1);
    slow(h, 'buyIn');
    const seating = h.table.takeSeat(h.ids[1], 1, 2000);
    await new Promise((r) => setTimeout(r, 5));
    h.table.disconnect(h.ids[1]); // a spectator is dropped at once
    expect(await seating).toEqual({ ok: true });
    expect(h.table.roleOf(h.ids[1])).toBe('seated');
    // …and is stood up (cashed out) by the disconnect sweep like any seated player.
    await waitFor(() => h.left.some((l) => l.playerId === h.ids[1]), 3000, 'stand-up after disconnect');
    await h.table.settled();
    expect(await h.services.bank.escrowed(h.ids[1])).toBe(0);
    expect(await h.balance(1)).toBe(10_000);
  });
});

describe('top-up limits', () => {
  it('concurrent top-ups cannot take a stack past the maximum buy-in', async () => {
    const h = await setup(1);
    await h.seat(0, 0, 1000);
    slow(h, 'topUp');
    const results = await Promise.all([h.table.topUp(h.ids[0], 3000), h.table.topUp(h.ids[0], 3000)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await h.services.bank.escrowed(h.ids[0])).toBe(4000);
    expect(h.view(0).seats[0].player!.stack).toBe(4000);
  });

  it('trims a queued top-up that a won pot would push past the maximum, and says so', async () => {
    const h = await setup(2);
    await h.seat(0, 0, 1000);
    await h.seat(1, 1, 1000);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    expect(h.toAct()).toBe(h.ids[0]); // heads-up: the button acts first
    expect(await h.table.topUp(h.ids[0], 4025)).toEqual({ ok: true }); // 975 behind + 4025 = 5000
    h.table.act(h.ids[0], { type: 'raise', amount: 100 });
    h.table.act(h.ids[1], { type: 'fold' }); // p0 wins the blinds: 1050
    await waitFor(() => h.view(0).handsDealt >= 2 && h.table.viewFor(h.ids[0]).you.pendingTopUp === 0, 3000, 'boundary');
    await h.table.settled();
    expect(await h.services.bank.escrowed(h.ids[0])).toBe(5000);
    expect(await h.balance(0)).toBe(10_000 - 1000 - 3950);
    expect(h.notices.some((n) => n.playerId === h.ids[0] && n.notice.title === 'Top-up reduced')).toBe(true);
  });
});

describe('server shutdown', () => {
  it('voids a hand in progress and cashes everyone out at their pre-hand stacks', async () => {
    const h = await setup(3);
    await h.seat(0, 0, 2000);
    await h.seat(1, 1, 3000);
    await h.join(2);
    const before = await h.chipsInPlay();
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    h.table.act(h.toAct()!, { type: 'raise', amount: 500 });
    await h.table.shutdown();
    expect(h.closed).toBe(true);
    expect(h.table.isClosed).toBe(true);
    for (const id of h.ids) expect(await h.services.bank.escrowed(id)).toBe(0);
    expect(await h.balance(0)).toBe(10_000);
    expect(await h.balance(1)).toBe(10_000);
    expect(await h.chipsInPlay()).toBe(before);
    expect(new Set(h.left.map((l) => l.playerId))).toEqual(new Set(h.ids));
    expect(h.table.act(h.ids[1], { type: 'fold' })).toMatchObject({ ok: false });
  });

  it('keeps the result of a finished hand when shutting down between hands', async () => {
    const h = await setup(2, { timing: { foldWinMs: 200 } });
    await h.seat(0, 0, 2000);
    await h.seat(1, 1, 2000);
    h.table.start(h.ids[0]);
    await waitFor(() => h.toAct() !== null);
    h.table.act(h.toAct()!, { type: 'fold' }); // the button folds its small blind
    await waitFor(() => !!h.view(0).hand?.result, 3000, 'result');
    await h.table.shutdown();
    expect(await h.balance(0)).toBe(10_000 - 25);
    expect(await h.balance(1)).toBe(10_000 + 25);
  });
});
