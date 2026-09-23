import { afterEach, describe, expect, it } from 'vitest';
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
    expect(h.table.updateRules(h.ids[0], { turnSeconds: 45 })).toEqual({ ok: true });
    expect(h.table.updateRules(h.ids[0], { turnSeconds: 7 })).toMatchObject({ ok: false });
    expect(h.table.updateRules(h.ids[1], { turnSeconds: 45 })).toMatchObject({ ok: false });
    await h.seat(0, 5);
    expect(h.table.updateRules(h.ids[0], { maxSeats: 4 })).toMatchObject({ ok: false });
    await h.seat(1, 1);
    h.table.start(h.ids[0]);
    expect(h.table.updateRules(h.ids[0], { turnSeconds: 60 })).toMatchObject({ ok: false });
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
