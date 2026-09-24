import { afterEach, describe, expect, it } from 'vitest';
import { createServices } from '../services/index.js';
import { getPlayerRow, toPublic } from '../services/players.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { FAST, waitFor } from '../test/table-harness.js';
import { seededRandomInt } from '../engine/index.js';
import { RoomManager, type Outbox } from './instance-room.js';

const t = useTestDb();
let manager: RoomManager | null = null;
afterEach(() => {
  manager?.dispose();
  manager = null;
});

function setup() {
  const services = createServices(t.db);
  const left: { playerId: string; reason: string }[] = [];
  const outbox: Outbox = {
    lobby: () => undefined,
    tableView: () => undefined,
    tableLeft: (_i, playerId, reason) => left.push({ playerId, reason }),
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

    await rooms.shutdown();
    expect(t1.isClosed && t2.isClosed).toBe(true);
    expect(r1.currentTable).toBeNull();
    expect(r2.currentTable).toBeNull();
    for (const p of [a, b, c, d]) {
      expect(await services.bank.escrowed(p.id)).toBe(0);
      expect(await services.bank.balance(p.id)).toBe(10_000);
    }
    expect(new Set(left.map((l) => l.playerId))).toEqual(new Set([a.id, b.id, c.id, d.id]));
  });
});
