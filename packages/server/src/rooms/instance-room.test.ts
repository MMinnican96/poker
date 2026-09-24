import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { TableLeft } from '@poker/shared';
import { serverLeases, tableSeats } from '../db/schema.js';
import { Bank, LEASE_STALE_MS } from '../services/bank.js';
import { createServices } from '../services/index.js';
import { ServerLease } from '../services/leases.js';
import { getPlayerRow, toPublic } from '../services/players.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { FAST, waitFor } from '../test/table-harness.js';
import { seededRandomInt } from '../engine/index.js';
import { RECONNECTING, RESTARTING, RoomManager, type Outbox } from './instance-room.js';
import { guardTablesWithLease } from './lease-guard.js';

const t = useTestDb();
let manager: RoomManager | null = null;
afterEach(() => {
  manager?.dispose();
  manager = null;
});

function setup(leaseId: string | null = null) {
  const services = createServices(t.db, undefined, { leaseId });
  const left: ({ playerId: string } & TableLeft)[] = [];
  const outbox: Outbox = {
    lobby: () => undefined,
    tableView: () => undefined,
    tableLeft: (_i, playerId, l) => left.push({ playerId, ...l }),
    fx: () => undefined,
    activity: () => undefined,
    notice: () => undefined,
    refreshMe: () => undefined,
  };
  manager = new RoomManager({ services, outbox, timing: FAST, random: seededRandomInt(3) });
  return { services, left, rooms: manager };
}

async function player(): Promise<{ id: string; pub: ReturnType<typeof toPublic> }> {
  const id = await makePlayer(t.db, 'room');
  return { id, pub: toPublic((await getPlayerRow(t.db, id))!) };
}

describe('RoomManager', () => {
  it('prunes a room once its table closes with nobody present', async () => {
    const { rooms } = setup();
    const a = await player();
    const room = rooms.getOrCreate('inst-prune');
    room.join(a.pub, 10_000, 'sock-1');
    expect(await room.openTable(a.id, {})).toEqual({ ok: true });
    await room.currentTable!.takeSeat(a.id, 0, 2000);
    // The last socket goes; the room stays while the table (with a seated player) is open.
    room.leaveSocket(a.id, 'sock-1');
    rooms.prune('inst-prune');
    expect(rooms.get('inst-prune')).toBe(room);
    // The disconnected player is stood up, the table closes — and the room goes with it.
    await waitFor(() => !room.currentTable, 3000, 'table close');
    expect(rooms.get('inst-prune')).toBeUndefined();
    expect(rooms.size).toBe(0);
  });

  it('shutdown cashes out every table, voiding hands in progress', async () => {
    const { rooms, services, left } = setup();
    const [a, b, c, d] = [await player(), await player(), await player(), await player()];
    const r1 = rooms.getOrCreate('inst-s1');
    const r2 = rooms.getOrCreate('inst-s2');
    r1.join(a.pub, 10_000, 's-a');
    r1.join(b.pub, 10_000, 's-b');
    r2.join(c.pub, 10_000, 's-c');
    r2.join(d.pub, 10_000, 's-d');
    await r1.openTable(a.id, {});
    await r2.openTable(c.id, {});
    const t1 = r1.currentTable!;
    const t2 = r2.currentTable!;
    await t1.watch(b.pub);
    await t2.watch(d.pub);
    await t1.takeSeat(a.id, 0, 2000);
    await t1.takeSeat(b.id, 1, 3000);
    await t2.takeSeat(c.id, 0, 1500);
    await t2.takeSeat(d.id, 1, 1500);
    t1.start(a.id);
    await waitFor(() => !!t1.viewFor(a.id).hand, 3000, 'a hand');

    const first = rooms.shutdown();
    // Idempotent: a second call (e.g. app.close after index.ts) shares the first.
    expect(rooms.shutdown()).toBe(first);
    await first;
    expect(t1.isClosed && t2.isClosed).toBe(true);
    expect(r1.currentTable).toBeNull();
    expect(r2.currentTable).toBeNull();
    for (const p of [a, b, c, d]) {
      expect(await services.bank.escrowed(p.id)).toBe(0);
      expect(await services.bank.balance(p.id)).toBe(10_000);
    }
    expect(new Set(left.map((l) => l.playerId))).toEqual(new Set([a.id, b.id, c.id, d.id]));
    expect(new Set(left.map((l) => l.code))).toEqual(new Set(['shutdown']));
  });

  it('refuses new tables, seats and top-ups while suspended or shutting down', async () => {
    const { rooms } = setup();
    const [a, b] = [await player(), await player()];
    const room = rooms.getOrCreate('inst-gate');
    room.join(a.pub, 10_000, 's-a');
    room.join(b.pub, 10_000, 's-b');
    rooms.suspend(RECONNECTING);
    expect(await room.openTable(a.id, {})).toEqual({ ok: false, error: RECONNECTING });
    rooms.resume();
    expect(await room.openTable(a.id, {})).toEqual({ ok: true });
    const table = room.currentTable!;
    await table.watch(b.pub);
    expect(await table.takeSeat(a.id, 0, 2000)).toEqual({ ok: true });
    rooms.suspend(RECONNECTING);
    expect(await table.takeSeat(b.id, 1, 2000)).toEqual({ ok: false, error: RECONNECTING });
    expect(await table.topUp(a.id, 500)).toEqual({ ok: false, error: RECONNECTING });
    rooms.resume();
    expect(await table.topUp(a.id, 500)).toEqual({ ok: true });

    const other = rooms.getOrCreate('inst-gate-2');
    other.join(b.pub, 10_000, 's-b2');
    await rooms.shutdown();
    expect(rooms.unavailable).toBe(RESTARTING);
    // Resuming after a lease renewal never reopens a server that is stopping.
    rooms.resume();
    expect(await other.openTable(b.id, {})).toEqual({ ok: false, error: RESTARTING });
  });

  it('a lost lease abandons every table without cashing out again, then new seats carry a fresh lease', async () => {
    const lease = new ServerLease(t.db, { log: () => undefined });
    await lease.register();
    const { rooms, services, left } = setup(lease.id);
    guardTablesWithLease(lease, services.bank, rooms, () => undefined);
    const [a, b] = [await player(), await player()];
    const room = rooms.getOrCreate('inst-lost');
    room.join(a.pub, 10_000, 's-a');
    room.join(b.pub, 10_000, 's-b');
    await room.openTable(a.id, {});
    const table = room.currentTable!;
    await table.watch(b.pub);
    await table.takeSeat(a.id, 0, 2000);
    await table.takeSeat(b.id, 1, 3000);
    table.start(a.id);
    await waitFor(() => !!table.viewFor(a.id).hand, 3000, 'a hand');

    // This process stalled: its lease went stale and another process refunded its seats.
    const old = lease.id;
    await t.db.update(serverLeases).set({ heartbeatAt: new Date(Date.now() - LEASE_STALE_MS - 5_000) })
      .where(eq(serverLeases.id, old));
    const refunded = await new Bank(t.db, randomUUID()).recoverOpenSeats();
    expect(refunded.seats).toBeGreaterThanOrEqual(2);

    await lease.heartbeat();
    expect(table.isClosed).toBe(true);
    expect(room.currentTable).toBeNull();
    expect(left.map((l) => [l.playerId, l.code]).sort()).toEqual([[a.id, 'interrupted'], [b.id, 'interrupted']].sort());
    // Refunded exactly once (by the other process's recovery).
    for (const p of [a, b]) {
      expect(await services.bank.escrowed(p.id)).toBe(0);
      expect(await services.bank.balance(p.id)).toBe(10_000);
    }

    // A fresh lease is held and stamped on new seats; tables can be opened again.
    expect(lease.id).not.toBe(old);
    expect(services.bank.leaseId).toBe(lease.id);
    expect(rooms.unavailable).toBeNull();
    expect(await room.openTable(a.id, {})).toEqual({ ok: true });
    expect(await room.currentTable!.takeSeat(a.id, 0, 2000)).toEqual({ ok: true });
    const [seat] = await t.db.select().from(tableSeats)
      .where(eq(tableSeats.tableId, room.currentTable!.tableId));
    expect(seat.leaseId).toBe(lease.id);
    await rooms.shutdown();
    await lease.release();
  });
});
