import { randomUUID } from 'node:crypto';
import {
  validateRules,
  type ActivityEvent,
  type LobbyState,
  type Notice,
  type PublicPlayer,
  type RoomMember,
  type TableFx,
  type TableLeft,
  type TableRules,
  type TableView,
} from '@poker/shared';
import type { Services } from '../services/index.js';
import type { RandomInt } from '../engine/index.js';
import { TableRoom, type Result, type TableTiming } from './table-room.js';

/** Outgoing messages, implemented by the socket layer. */
export interface Outbox {
  lobby(instanceId: string, state: LobbyState): void;
  tableView(instanceId: string, playerId: string, view: TableView): void;
  tableLeft(instanceId: string, playerId: string, left: TableLeft): void;
  fx(instanceId: string, fx: TableFx): void;
  activity(instanceId: string, event: ActivityEvent): void;
  notice(playerId: string, notice: Notice): void;
  /** Re-send the player's own profile (balance, XP, items). */
  refreshMe(playerId: string): void;
}

export interface RoomDeps {
  services: Services;
  outbox: Outbox;
  timing?: Partial<TableTiming>;
  random?: RandomInt;
  clock?: () => number;
}

interface Presence {
  player: PublicPlayer;
  balance: number;
  sockets: Set<string>;
}

const ACTIVITY_KEEP = 40;

/**
 * Everything happening in one Discord Activity instance: who is present, the
 * (single) table, and the room's activity feed.
 */
export class InstanceRoom {
  private readonly presence = new Map<string, Presence>();
  private readonly feed: ActivityEvent[] = [];
  private table: TableRoom | null = null;
  private readonly clock: () => number;

  /**
   * @param onIdle called when the room may have become empty without a socket
   * event (its table closed) so the manager can prune it.
   */
  constructor(readonly instanceId: string, private readonly deps: RoomDeps, private readonly onIdle: () => void = () => undefined) {
    this.clock = deps.clock ?? Date.now;
  }

  get isEmpty(): boolean {
    return this.presence.size === 0 && !this.table;
  }

  get currentTable(): TableRoom | null {
    return this.table;
  }

  activityHistory(): ActivityEvent[] {
    return this.feed.slice();
  }

  isPresent(playerId: string): boolean {
    return this.presence.has(playerId);
  }

  join(player: PublicPlayer, balance: number, socketId: string): void {
    const existing = this.presence.get(player.id);
    if (existing) {
      existing.player = player;
      existing.balance = balance;
      existing.sockets.add(socketId);
    } else {
      this.presence.set(player.id, { player, balance, sockets: new Set([socketId]) });
    }
    this.table?.connect(player.id);
    this.broadcastLobby();
  }

  /** A socket went away. The player leaves the room when their last socket does. */
  leaveSocket(playerId: string, socketId: string): void {
    const p = this.presence.get(playerId);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size > 0) return;
    this.presence.delete(playerId);
    this.table?.disconnect(playerId);
    this.broadcastLobby();
  }

  /** Fresh profile/balance for a present player (after purchases, cash-outs, level-ups). */
  updatePlayer(player: PublicPlayer, balance: number): void {
    const p = this.presence.get(player.id);
    if (p) {
      p.player = player;
      p.balance = balance;
    }
    void this.table?.refreshPlayer(player);
    this.broadcastLobby();
  }

  balanceOf(playerId: string): number {
    return this.presence.get(playerId)?.balance ?? 0;
  }

  async openTable(playerId: string, patch: Partial<TableRules>): Promise<Result> {
    const host = this.presence.get(playerId);
    if (!host) return { ok: false, error: 'Join the room first.' };
    if (this.table) return { ok: false, error: 'A table is already open. Join it from the lobby.' };
    const r = validateRules(patch);
    if (!r.ok) return r;
    if (!(await this.deps.services.shop.owns(playerId, r.rules.feltId))) {
      return { ok: false, error: "You don't own that felt." };
    }
    if (host.balance < r.rules.minBuyIn) {
      return { ok: false, error: "You can't afford this table's minimum buy-in." };
    }
    if (this.table) return { ok: false, error: 'A table is already open. Join it from the lobby.' };
    const table = new TableRoom(this.instanceId, r.rules, host.player, {
      bank: this.deps.services.bank,
      recorder: this.deps.services.recorder,
      shop: this.deps.services.shop,
      timing: this.deps.timing,
      random: this.deps.random,
      clock: this.deps.clock,
      hooks: {
        sendView: (id, view) => {
          view.you.bankroll = this.balanceOf(id);
          this.deps.outbox.tableView(this.instanceId, id, view);
        },
        fx: (fx) => this.deps.outbox.fx(this.instanceId, fx),
        left: (id, left) => this.deps.outbox.tableLeft(this.instanceId, id, left),
        changed: () => this.broadcastLobby(),
        balanceChanged: (id) => this.deps.outbox.refreshMe(id),
        notice: (id, n) => this.deps.outbox.notice(id, { id: randomUUID(), ...n }),
        activity: (e) => this.pushActivity(e),
        closed: () => {
          if (this.table === table) this.table = null;
          this.broadcastLobby();
          this.onIdle();
        },
      },
    });
    this.table = table;
    await table.watch(host.player);
    this.pushActivity({ kind: 'table', playerId, playerName: host.player.name, text: `opened ${r.rules.name}` });
    this.broadcastLobby();
    return { ok: true };
  }

  pushActivity(e: Omit<ActivityEvent, 'id' | 'at'>): void {
    const event: ActivityEvent = { ...e, id: randomUUID(), at: this.clock() };
    this.feed.push(event);
    if (this.feed.length > ACTIVITY_KEEP) this.feed.splice(0, this.feed.length - ACTIVITY_KEEP);
    this.deps.outbox.activity(this.instanceId, event);
  }

  state(): LobbyState {
    const members: RoomMember[] = [...this.presence.values()].map((p) => {
      const role = this.table?.roleOf(p.player.id) ?? null;
      return {
        ...p.player,
        balance: p.balance,
        presence: role === 'seated' ? 'playing' : role === 'spectator' ? 'watching' : 'lobby',
      };
    });
    return { instanceId: this.instanceId, members, table: this.table?.summary() ?? null };
  }

  broadcastLobby(): void {
    this.deps.outbox.lobby(this.instanceId, this.state());
  }

  /** Server shutdown: cash everyone at the table out (voiding a hand in progress). */
  async shutdown(): Promise<void> {
    await this.table?.shutdown();
  }

  dispose(): void {
    this.table?.dispose();
  }
}

/** One InstanceRoom per Discord Activity instance. */
export class RoomManager {
  private readonly rooms = new Map<string, InstanceRoom>();
  private shuttingDown: Promise<void> | null = null;

  constructor(private readonly deps: RoomDeps) {}

  get(instanceId: string): InstanceRoom | undefined {
    return this.rooms.get(instanceId);
  }

  getOrCreate(instanceId: string): InstanceRoom {
    let room = this.rooms.get(instanceId);
    if (!room) {
      room = new InstanceRoom(instanceId, this.deps, () => this.prune(instanceId));
      this.rooms.set(instanceId, room);
    }
    return room;
  }

  /** Drop rooms with nobody present and no table. */
  prune(instanceId: string): void {
    const room = this.rooms.get(instanceId);
    if (room?.isEmpty) this.rooms.delete(instanceId);
  }

  /** Number of live rooms (tests, diagnostics). */
  get size(): number {
    return this.rooms.size;
  }

  /** Every room a player is present in (for pushing profile updates). */
  roomsWith(playerId: string): InstanceRoom[] {
    return [...this.rooms.values()].filter((r) => r.isPresent(playerId) || r.currentTable?.isMember(playerId));
  }

  /**
   * Graceful shutdown: close every table, cashing everyone out at their
   * between-hands stack (a hand in progress is voided). Call before `dispose()`.
   * Idempotent: later calls share the first call's promise.
   */
  shutdown(): Promise<void> {
    this.shuttingDown ??= (async () => {
      const results = await Promise.allSettled([...this.rooms.values()].map((r) => r.shutdown()));
      for (const r of results) if (r.status === 'rejected') console.error('[rooms] shutdown failed', r.reason);
    })();
    return this.shuttingDown;
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
  }
}
