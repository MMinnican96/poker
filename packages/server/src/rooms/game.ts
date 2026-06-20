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

interface Seat {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  socketId: string;
  chipStack: number;
  left: boolean;
  disconnected: boolean;
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

  private seats: Seat[] = [];
  private dealerIndex = 0;
  private handNumber = 0;
  private ctx: HandContext | null = null;
  private handInProgress = false;
  private stopped = false;

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
    this.seats = opts.players.map((p) => ({
      ...p,
      chipStack: 0,
      left: false,
      disconnected: false,
      joinedAt: now,
    }));
  }

  /** Deduct buy-ins from each player's bankroll, then deal the first hand. */
  async start(): Promise<void> {
    await Promise.all(
      this.seats.map(async (seat) => {
        await this.chips.adjust({
          playerId: seat.discordUserId,
          amount: -this.config.buyIn,
          type: 'buy-in',
          idempotencyKey: `${this.gameId}:buyin:${seat.discordUserId}`,
        });
        seat.chipStack = this.config.buyIn;
      }),
    );
    if (this.stopped) return;
    this.startHand();
  }

  private startHand(): void {
    if (this.stopped) return;
    const live = this.seats.filter((s) => !s.left && !s.disconnected && s.chipStack > 0);
    if (live.length < 2) {
      void this.endGame();
      return;
    }

    const seeds: PlayerSeed[] = this.seats.map((s, i) => ({
      discordUserId: s.discordUserId,
      displayName: s.displayName,
      avatarUrl: s.avatarUrl,
      seatIndex: i,
      chipStack: s.left ? 0 : s.chipStack,
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
    const seat = this.seats.find((s) => s.discordUserId === current.discordUserId);

    // Disconnected players don't get a timer — fold them straight away.
    if (seat?.disconnected) {
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

    // Mirror the engine's chip stacks back onto the seats.
    for (const seat of this.seats) {
      const p = state.players.find((pp) => pp.discordUserId === seat.discordUserId);
      if (p) seat.chipStack = p.chipStack;
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
    const live = this.seats.filter((s) => !s.left && !s.disconnected && s.chipStack > 0);
    if (live.length < 2) {
      void this.endGame();
      return;
    }
    this.dealerIndex = this.nextDealer();
    this.nextHandTimeout = setTimeout(() => this.startHand(), this.handDelayMs);
  }

  private nextDealer(): number {
    const n = this.seats.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.dealerIndex + step) % n;
      const seat = this.seats[idx];
      if (!seat.left && seat.chipStack > 0) return idx;
    }
    return this.dealerIndex;
  }

  /** Leave the table — only allowed between hands. Cashes out remaining chips. */
  leave(playerId: string): void {
    if (this.handInProgress) return;
    const seat = this.seats.find((s) => s.discordUserId === playerId);
    if (!seat || seat.left) return;
    void this.cashOut(seat);
    seat.playMs = Date.now() - seat.joinedAt;
    seat.left = true;
    const live = this.seats.filter((s) => !s.left && s.chipStack > 0);
    if (live.length < 2) void this.endGame();
  }

  /** A socket dropped: mark the seat disconnected and auto-fold if it's their turn. */
  handleDisconnect(socketId: string): void {
    const seat = this.seats.find((s) => s.socketId === socketId);
    if (!seat || seat.left) return;
    seat.disconnected = true;
    if (this.handInProgress && this.ctx) {
      const state = this.ctx.state;
      const current = state.players[state.currentPlayerIndex];
      if (current.discordUserId === seat.discordUserId) {
        this.handleAction(seat.discordUserId, { type: 'fold' });
      }
    }
  }

  /**
   * A player rejoined the instance: rebind their socket, clear the disconnected
   * flag so they resume normal play, and push them the current state. They can
   * reconnect mid-hand (they're still seated) and the game continues normally.
   */
  reconnect(playerId: string, socketId: string): void {
    const seat = this.seats.find((s) => s.discordUserId === playerId);
    if (!seat || seat.left) return;
    seat.socketId = socketId;
    seat.disconnected = false;
    if (this.ctx) {
      this.io.to(socketId).emit('game_state_update', viewFor(this.ctx.state, playerId));
    }
  }

  private async endGame(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTurnTimer();
    if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);

    const now = Date.now();
    const sessionPlayers = this.seats.map((s) => ({
      playerId: s.discordUserId,
      playMs: s.playMs ?? now - s.joinedAt,
    }));
    void this.stats
      .recordSession({ gameId: this.gameId, players: sessionPlayers })
      .catch((err) => console.error('[stats] recordSession failed:', err));
    await Promise.all(this.seats.filter((s) => !s.left && s.chipStack > 0).map((s) => this.cashOut(s)));

    this.onEnd?.(this.gameId);
  }

  /** Stop all timers without cashing out (test/teardown safety). */
  stop(): void {
    this.stopped = true;
    this.clearTurnTimer();
    if (this.nextHandTimeout) clearTimeout(this.nextHandTimeout);
  }

  private async cashOut(seat: Seat): Promise<void> {
    if (seat.chipStack <= 0) return;
    const amount = seat.chipStack;
    seat.chipStack = 0;
    await this.chips.adjust({
      playerId: seat.discordUserId,
      amount,
      type: 'cash-out',
      idempotencyKey: `${this.gameId}:cashout:${seat.discordUserId}`,
    });
  }

  private broadcastState(): void {
    if (!this.ctx) return;
    for (const seat of this.seats) {
      if (seat.left) continue;
      this.io.to(seat.socketId).emit('game_state_update', viewFor(this.ctx.state, seat.discordUserId));
    }
  }

  private emitToPlayer<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const seat = this.seats.find((s) => s.discordUserId === playerId);
    if (seat) this.io.to(seat.socketId).emit(event, ...args);
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
}
