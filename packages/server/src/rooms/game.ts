import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  PlayerAction,
  PlayerHandStat,
  ServerToClientEvents,
  SocketData,
  TableConfig,
} from '@poker/shared';
import {
  startHand,
  act,
  settleHand,
  contenders,
  type HandContext,
  type PlayerSeed,
} from '../engine/index.js';
import { viewFor } from './state-view.js';
import { HandStatsTracker, buildHandFacts } from './hand-stats.js';

type GameIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Atomic, idempotent chip ledger. Production binds this to the DB; tests fake it. */
export interface ChipService {
  adjust(input: {
    playerId: string;
    amount: number;
    type: string;
    idempotencyKey: string;
  }): Promise<{ applied: boolean; balance: number }>;
}

/** No-op ledger (used when a room is created without persistence, e.g. lobby-only tests). */
export const noopChipService: ChipService = {
  async adjust() {
    return { applied: true, balance: 0 };
  },
};

/** Atomic, idempotent stats writer. Production binds this to the DB; tests fake it. */
export interface StatsService {
  recordHand(facts: PlayerHandStat[]): Promise<void>;
  recordSession(input: {
    gameId: string;
    players: { playerId: string; playMs: number }[];
  }): Promise<void>;
}

/** No-op stats writer (dev/mock mode, lobby-only tests). */
export const noopStatsService: StatsService = {
  async recordHand() {},
  async recordSession() {},
};

export interface GameTiming {
  /** Time a player has to act before auto-fold/check. */
  turnMs?: number;
  /** How often TIMER_TICK is broadcast. */
  tickMs?: number;
  /** Pause between hands. */
  handDelayMs?: number;
}

export interface GameRoomPlayer {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  socketId: string;
  bankroll: number;
}

export interface GameRoomOptions {
  io: GameIo;
  gameId: string;
  instanceId: string;
  config: TableConfig;
  players: GameRoomPlayer[];
  chips?: ChipService;
  stats?: StatsService;
  timing?: GameTiming;
  onEnd?: (gameId: string) => void;
}

type MemberRole = 'seated' | 'spectator';
type Pending = null | 'leave' | 'spectate' | 'seat';

interface Member {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  socketId: string;
  role: MemberRole;
  chipStack: number;     // 0 for spectators
  bankroll: number;      // last-known lobby balance, gates sit-in
  seatSession: number;   // ++ each time they take a seat
  pending: Pending;
  left: boolean;
  disconnected: boolean;
  disconnectedAt?: number;
  joinedAt: number;
  playMs?: number;
}

/**
 * Authoritative server-side game session for one Discord instance. Owns the
 * engine `HandContext`, drives the turn timer, persists buy-ins/cash-outs
 * through the injected ChipService, and broadcasts sanitized state per viewer.
 */
export class GameRoom {
  private readonly io: GameIo;
  readonly gameId: string;
  readonly instanceId: string;
  private readonly config: TableConfig;
  private readonly chips: ChipService;
  private readonly stats: StatsService;
  private tracker: HandStatsTracker | null = null;
  private readonly turnMs: number;
  private readonly tickMs: number;
  private readonly handDelayMs: number;
  private readonly onEnd?: (gameId: string) => void;
  /** Set by rooms/index.ts to notify the lobby when the membership roster changes. */
  onMembershipChange?: () => void;

  private members: Member[] = [];
  private dealerIndex = 0;
  private handNumber = 0;
  private ctx: HandContext | null = null;
  private handInProgress = false;
  private stopped = false;
  /**
   * Guards recordSession so it runs at most once per room lifetime.
   * Note: durable cross-process idempotency would require a dedicated sessions
   * table (deferred); this in-memory guard + `this.stopped` cover the single-room case.
   */
  private sessionRecorded = false;

  private turnTimeout: ReturnType<typeof setTimeout> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private nextHandTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: GameRoomOptions) {
    this.io = opts.io;
    this.gameId = opts.gameId;
    this.instanceId = opts.instanceId;
    this.config = opts.config;
    this.chips = opts.chips ?? noopChipService;
    this.stats = opts.stats ?? noopStatsService;
    this.turnMs = opts.timing?.turnMs ?? 10_000;
    this.tickMs = opts.timing?.tickMs ?? 500;
    this.handDelayMs = opts.timing?.handDelayMs ?? 3_000;
    this.onEnd = opts.onEnd;
    const now = Date.now();
    this.members = opts.players.map((p) => ({
      ...p,
      role: 'seated' as const,
      chipStack: 0,
      seatSession: 0,
      pending: null,
      left: false,
      disconnected: false,
      joinedAt: now,
    }));
  }

  /** Deduct buy-ins from each player's bankroll, then deal the first hand. */
  async start(): Promise<void> {
    await Promise.all(
      this.seated().map(async (m) => {
        m.seatSession += 1;
        await this.chips.adjust({
          playerId: m.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
        });
        m.chipStack = this.config.buyIn;
      }),
    );
    if (this.stopped) return;
    this.startHand();
  }

  /** Spectator asks for a seat. Applied at the next hand boundary (or now if idle). */
  requestSeat(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.role === 'seated') return;
    if (!this.canSeat(m)) return; // gated: full or underfunded
    m.pending = 'seat';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  private canSeat(m: Member): boolean {
    return this.seated().length < this.config.maxPlayers && m.bankroll >= this.config.buyIn;
  }

  /** Resolve queued transitions + busts. Called at each hand boundary. */
  private applyPending(): void {
    for (const m of this.members) {
      if (m.role === 'seated' && m.chipStack <= 0) {
        m.role = 'spectator'; // bust → spectate (Task 6 also covers settle-time)
      }
      if (m.pending === 'seat' && m.role === 'spectator' && this.canSeat(m)) {
        m.seatSession += 1;
        void this.chips.adjust({
          playerId: m.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${m.discordUserId}:${m.seatSession}`,
        });
        m.chipStack = this.config.buyIn;
        m.role = 'seated';
      } else if (m.pending === 'spectate' && m.role === 'seated') {
        void this.cashOut(m);
        m.role = 'spectator';
      } else if (m.pending === 'leave') {
        void this.cashOut(m);
        m.left = true;
        m.playMs = Date.now() - m.joinedAt;
        this.io.to(m.socketId).emit('left_table');
      }
      m.pending = null;
    }
  }

  private resolveBetweenHands(): void {
    this.applyPending();
    this.scheduleNextHand();
  }

  private startHand(): void {
    this.applyPending();
    if (this.stopped) return;
    if (this.seatedLive().length < 2) {
      void this.endGame();
      return;
    }

    const seatedMembers = this.seated();
    const seeds: PlayerSeed[] = seatedMembers.map((m, i) => ({
      discordUserId: m.discordUserId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      seatIndex: i,
      chipStack: m.chipStack,
    }));

    this.handNumber += 1;
    this.ctx = startHand({
      gameId: this.gameId,
      instanceId: this.instanceId,
      handNumber: this.handNumber,
      dealerIndex: this.dealerIndex,
      seeds,
      config: this.config,
    });
    this.handInProgress = true;
    this.tracker = new HandStatsTracker(Date.now());

    // A player who is already disconnected should be folded immediately.
    this.broadcastState();
    this.beginTurn();
  }

  /** Validate + apply a player action, then progress the hand. */
  handleAction(playerId: string, action: PlayerAction): void {
    if (!this.ctx || !this.handInProgress) return;
    const street = this.ctx.state.phase;
    const result = act(this.ctx, playerId, action);
    if (!result.ok) {
      this.emitToPlayer(playerId, 'action_rejected', { reason: result.reason });
      return;
    }
    this.tracker?.record(playerId, street, action.type);
    this.clearTurnTimer();
    this.afterAction();
  }

  private afterAction(): void {
    const state = this.ctx!.state;
    if (state.phase === 'showdown' || state.phase === 'hand-complete') {
      this.concludeHand();
    } else {
      this.broadcastState();
      this.beginTurn();
    }
  }

  private beginTurn(): void {
    const state = this.ctx!.state;
    const current = state.players[state.currentPlayerIndex];
    const member = this.members.find((m) => m.discordUserId === current.discordUserId);

    // Disconnected players don't get a timer — fold them straight away.
    if (member?.disconnected) {
      this.handleAction(current.discordUserId, { type: 'fold' });
      return;
    }
    this.startTurnTimer(current.discordUserId);
  }

  private startTurnTimer(playerId: string): void {
    this.clearTurnTimer();
    const startedAt = Date.now();
    this.tickInterval = setInterval(() => {
      const remainingMs = Math.max(0, this.turnMs - (Date.now() - startedAt));
      this.io.to(this.instanceId).emit('timer_tick', { playerId, remainingMs });
    }, this.tickMs);
    this.turnTimeout = setTimeout(() => {
      this.handleAction(playerId, this.autoAction(playerId));
    }, this.turnMs);
  }

  /** On timeout/disconnect: check if free, otherwise fold. */
  private autoAction(playerId: string): PlayerAction {
    const state = this.ctx!.state;
    const player = state.players.find((p) => p.discordUserId === playerId);
    const toCall = player ? state.callAmount - player.betThisRound : 1;
    return toCall === 0 ? { type: 'check' } : { type: 'fold' };
  }

  private concludeHand(): void {
    this.clearTurnTimer();
    const state = this.ctx!.state;
    const result = settleHand(state); // credits chipStacks, marks hand-complete

    // Mirror the engine's chip stacks back onto the members.
    for (const member of this.members) {
      const p = state.players.find((pp) => pp.discordUserId === member.discordUserId);
      if (p) member.chipStack = p.chipStack;
    }

    this.handInProgress = false;
    this.broadcastState();

    const potAmount = result.awards.reduce((sum, a) => sum + a.amount, 0);
    const winnerIds = [...new Set(result.awards.flatMap((a) => a.winnerIds))];
    const handName = result.hands[winnerIds[0]]?.name;
    this.io.to(this.instanceId).emit('hand_result', {
      winnerIds,
      potAmount,
      handName,
      finalState: viewFor(state, null),
    });

    if (this.tracker) {
      const facts = buildHandFacts({
        state,
        result,
        tracker: this.tracker,
        gameId: this.gameId,
        handNumber: this.handNumber,
        now: Date.now(),
      });
      void this.stats.recordHand(facts).catch((err) =>
        console.error('[stats] recordHand failed:', err),
      );
    }

    this.scheduleNextHand();
  }

  private scheduleNextHand(): void {
    if (this.stopped) return;
    if (this.seatedLive().length < 2) {
      void this.endGame();
      return;
    }
    this.dealerIndex = this.nextDealer();
    this.nextHandTimeout = setTimeout(() => this.startHand(), this.handDelayMs);
  }

  private nextDealer(): number {
    const seated = this.seated();
    const n = seated.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.dealerIndex + step) % n;
      const member = seated[idx];
      if (member.chipStack > 0) return idx;
    }
    return this.dealerIndex;
  }

  /** Seated → cash out to lobby (deferred to hand end). Spectator → leave now. */
  leave(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m) return;
    if (m.role === 'spectator') {
      m.left = true;
      this.io.to(m.socketId).emit('left_table');
      this.broadcastState();
      this.onMembershipChange?.();
      return;
    }
    m.pending = 'leave';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  /** Seated → cash out but keep watching (deferred to hand end). */
  moveToSpectate(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.role !== 'seated') return;
    m.pending = 'spectate';
    if (!this.handInProgress) this.resolveBetweenHands();
    else this.broadcastState();
    this.onMembershipChange?.();
  }

  /** Undo a queued transition before the hand boundary applies it. */
  cancelPending(playerId: string): void {
    const m = this.members.find((x) => x.discordUserId === playerId && !x.left);
    if (!m || m.pending === null) return;
    m.pending = null;
    this.broadcastState();
    this.onMembershipChange?.();
  }

  /** A socket dropped: mark the member disconnected and auto-fold if it's their turn. */
  handleDisconnect(socketId: string): void {
    const member = this.members.find((m) => m.socketId === socketId);
    if (!member || member.left || member.disconnected) return;
    member.disconnected = true;
    member.disconnectedAt = Date.now();
    if (this.handInProgress && this.ctx) {
      const state = this.ctx.state;
      const current = state.players[state.currentPlayerIndex];
      if (current.discordUserId === member.discordUserId) {
        this.handleAction(member.discordUserId, { type: 'fold' });
      }
    }
  }

  /**
   * A player rejoined the instance: rebind their socket, clear the disconnected
   * flag so they resume normal play, and push them the current state. They can
   * reconnect mid-hand (they're still seated) and the game continues normally.
   */
  reconnect(playerId: string, socketId: string): void {
    const member = this.members.find((m) => m.discordUserId === playerId);
    if (!member || member.left) return;
    member.socketId = socketId;
    member.disconnected = false;
    member.disconnectedAt = undefined;
    if (this.ctx) {
      this.io.to(socketId).emit('game_state_update', this.tableView(playerId));
    }
  }

  private async endGame(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTurnTimer();
    if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);

    if (!this.sessionRecorded) {
      this.sessionRecorded = true;
      const now = Date.now();
      const sessionPlayers = this.members.map((m) => {
        let playMs: number;
        if (m.playMs !== undefined) {
          // Player formally left — already stamped.
          playMs = m.playMs;
        } else if (m.disconnected && m.disconnectedAt !== undefined) {
          // Disconnected without leaving — cap at the drop time, not now.
          playMs = m.disconnectedAt - m.joinedAt;
        } else {
          playMs = now - m.joinedAt;
        }
        return { playerId: m.discordUserId, playMs };
      });
      void this.stats
        .recordSession({ gameId: this.gameId, players: sessionPlayers })
        .catch((err) => console.error('[stats] recordSession failed:', err));
    }

    await Promise.all(this.members.filter((m) => !m.left && m.chipStack > 0).map((m) => this.cashOut(m)));

    this.onEnd?.(this.gameId);
  }

  /** Stop all timers without cashing out (test/teardown safety). */
  stop(): void {
    this.stopped = true;
    this.clearTurnTimer();
    if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);
  }

  private async cashOut(m: Member): Promise<void> {
    if (m.chipStack <= 0) return;
    const amount = m.chipStack;
    m.chipStack = 0;
    await this.chips.adjust({
      playerId: m.discordUserId,
      amount,
      type: 'cash-out',
      idempotencyKey: `${this.gameId}:cashout:${m.discordUserId}:${m.seatSession}`,
    });
  }

  /** A lobby player chose to watch. Immediate; emits joined_table + state. */
  addSpectator(p: GameRoomPlayer): void {
    if (this.stopped) return;
    const existing = this.members.find((m) => m.discordUserId === p.discordUserId);
    if (existing && !existing.left) {
      existing.socketId = p.socketId; // reconnect/rebind
    } else {
      this.members.push({
        ...p,
        role: 'spectator',
        chipStack: 0,
        seatSession: existing?.seatSession ?? 0,
        pending: null,
        left: false,
        disconnected: false,
        joinedAt: Date.now(),
      });
    }
    this.io.to(p.socketId).emit('joined_table', { gameId: this.gameId, role: 'spectator' });
    this.broadcastState();
    this.onMembershipChange?.();
  }

  private spectatorMembers(): Member[] {
    return this.members.filter((m) => m.role === 'spectator' && !m.left);
  }

  /** The viewer's per-recipient view: sanitized cards + table-population fields. */
  private tableView(viewerId: string): GameState {
    const base = this.ctx ? viewFor(this.ctx.state, viewerId) : this.idleState();
    const me = this.members.find((m) => m.discordUserId === viewerId);
    return {
      ...base,
      spectators: this.spectatorMembers().map((m) => ({
        discordUserId: m.discordUserId,
        displayName: m.displayName,
        avatarUrl: m.avatarUrl,
      })),
      waitingForPlayers: this.seated().length < 2,
      viewerPending: me?.pending ?? null,
    };
  }

  private idleState(): GameState {
    // ctx is set after the first hand; before that there is nothing to show.
    return this.ctx!.state;
  }

  private broadcastState(): void {
    if (!this.ctx) return;
    for (const m of this.members) {
      if (m.left) continue;
      this.io.to(m.socketId).emit('game_state_update', this.tableView(m.discordUserId));
    }
  }

  private emitToPlayer<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const member = this.members.find((m) => m.discordUserId === playerId);
    if (member) this.io.to(member.socketId).emit(event, ...args);
  }

  private clearTurnTimer(): void {
    if (this.turnTimeout) {
      clearTimeout(this.turnTimeout);
      this.turnTimeout = null;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /** Exposed for inspection/tests. */
  get state() {
    return this.ctx?.state ?? null;
  }
  get isActive(): boolean {
    return !this.stopped;
  }
  contenderCount(): number {
    return this.ctx ? contenders(this.ctx.state).length : 0;
  }

  private seated(): Member[] {
    return this.members.filter((m) => m.role === 'seated' && !m.left);
  }

  /** Seated members who can be dealt in (have chips and aren't disconnected). */
  private seatedLive(): Member[] {
    return this.seated().filter((m) => !m.disconnected && m.chipStack > 0);
  }
}
