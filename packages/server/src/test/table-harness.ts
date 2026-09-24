import { eq, sql } from 'drizzle-orm';
import { DEFAULT_RULES, type ActivityEvent, type Notice, type TableLeft, type TableRules, type TableView } from '@poker/shared';
import type { Db } from '../db/client.js';
import { chipTransactions, players, tableSeats } from '../db/schema.js';
import { createServices, type Services } from '../services/index.js';
import { getPlayerRow, toPublic } from '../services/players.js';
import { TableRoom, type TableHooks, type TableTiming } from '../rooms/table-room.js';
import { seededRandomInt } from '../engine/index.js';
import { makePlayer } from './db.js';

export const FAST: Partial<TableTiming> = {
  streetMs: 0, runoutMs: 0, showdownMs: 0, foldWinMs: 0, showGraceMs: 0, handGapMs: 0, sweepMs: 20, disconnectStandMs: 50, turnMs: 60_000,
};

/** A TableRoom on a real (PGlite) bank with recording hooks. */
export class Harness {
  readonly views = new Map<string, TableView>();
  /** Every view sent, in order. */
  readonly sent: { playerId: string; view: TableView }[] = [];
  readonly notices: { playerId: string; notice: Omit<Notice, 'id'> }[] = [];
  readonly left: ({ playerId: string } & TableLeft)[] = [];
  readonly fx: unknown[] = [];
  readonly activity: Omit<ActivityEvent, 'id' | 'at'>[] = [];
  closed = false;
  table!: TableRoom;
  services: Services;

  constructor(readonly db: Db, readonly ids: string[]) {
    this.services = createServices(db);
  }

  static async create(db: Db, count: number, opts: { rules?: Partial<TableRules>; timing?: Partial<TableTiming>; seed?: number; clock?: () => number } = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(await makePlayer(db, 'tbl'));
    const h = new Harness(db, ids);
    const hooks: TableHooks = {
      sendView: (id, view) => { h.views.set(id, view); h.sent.push({ playerId: id, view }); },
      fx: (fx) => h.fx.push(fx),
      left: (playerId, left) => { h.left.push({ playerId, ...left }); h.views.delete(playerId); },
      changed: () => undefined,
      balanceChanged: () => undefined,
      notice: (playerId, notice) => h.notices.push({ playerId, notice }),
      activity: (e) => h.activity.push(e),
      closed: () => { h.closed = true; },
    };
    const host = toPublic((await getPlayerRow(db, ids[0]))!);
    h.table = new TableRoom('inst-test', { ...DEFAULT_RULES, ...opts.rules }, host, {
      bank: h.services.bank, recorder: h.services.recorder, shop: h.services.shop, hooks,
      timing: { ...FAST, ...opts.timing }, random: seededRandomInt(opts.seed ?? 7), clock: opts.clock,
      log: () => undefined,
    });
    await h.table.watch(host);
    return h;
  }

  async join(i: number) {
    const row = (await getPlayerRow(this.db, this.ids[i]))!;
    return this.table.watch(toPublic(row));
  }

  async seat(i: number, seat = i, buyIn = 2000) {
    if (!this.table.isMember(this.ids[i])) await this.join(i);
    return this.table.takeSeat(this.ids[i], seat, buyIn);
  }

  view(i: number): TableView {
    return this.table.viewFor(this.ids[i]);
  }

  /** Id of the player whose turn it is, if any. */
  toAct(): string | null {
    const v = this.table.viewFor(this.ids[0]);
    const seat = v.hand?.toActSeat;
    if (seat === null || seat === undefined || v.hand?.result) return null;
    return v.seats[seat].player?.id ?? null;
  }

  balance(i: number) {
    return this.services.bank.balance(this.ids[i]);
  }

  /**
   * Bankroll minus chips minted by level-ups and achievement unlocks, read in
   * one statement so a recording committing meanwhile can't skew it.
   */
  async bankroll(i: number): Promise<number> {
    const [row] = await this.db.select({
      b: sql<number>`${players.chipBalance} - coalesce((select sum(amount) from ${chipTransactions}
        where ${chipTransactions.playerId} = ${players.discordUserId} and ${chipTransactions.type} in ('level-up', 'achievement')), 0)`,
    }).from(players).where(eq(players.discordUserId, this.ids[i]));
    return Number(row.b);
  }

  /** Bankrolls + escrow of this harness's players, minus chips minted by level-ups and achievements. */
  async chipsInPlay(): Promise<number> {
    let total = 0;
    for (const id of this.ids) {
      const [p] = await this.db.select({ b: players.chipBalance }).from(players).where(eq(players.discordUserId, id));
      const [e] = await this.db.select({ s: sql<number>`coalesce(sum(stack),0)::int` }).from(tableSeats)
        .where(sql`${tableSeats.playerId} = ${id} and ${tableSeats.status} = 'open'`);
      const [m] = await this.db.select({ s: sql<number>`coalesce(sum(amount),0)::int` }).from(chipTransactions)
        .where(sql`${chipTransactions.playerId} = ${id} and ${chipTransactions.type} in ('level-up', 'achievement')`);
      total += p.b + Number(e.s) - Number(m.s);
    }
    return total;
  }
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
