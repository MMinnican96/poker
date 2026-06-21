import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import type {
  ActiveGameSummary,
  ClientToServerEvents,
  DiscordIdentity,
  InterServerEvents,
  LobbyPlayer,
  LobbyState,
  ServerToClientEvents,
  SocketData,
  TableConfig,
} from '@poker/shared';
import { DEFAULT_TABLE_CONFIG } from '@poker/shared';

type LobbyIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface LobbyManagerOptions {
  /** Countdown length before a game starts. Short in tests. */
  countdownMs?: number;
  /**
   * Called when a countdown completes with enough funded, ready players.
   * The game backend hooks the real GameRoom creation in here.
   */
  onGameStart?: (room: LobbyRoom, players: LobbyPlayer[], gameId: string) => void;
}

/**
 * One lobby per Discord Activity `instanceId`. Tracks the connected players,
 * their ready state, the table config, and the pre-game countdown.
 */
export class LobbyRoom {
  readonly instanceId: string;
  private readonly players = new Map<string, LobbyPlayer>();
  private status: LobbyState['status'] = 'waiting';
  private config: TableConfig = { ...DEFAULT_TABLE_CONFIG };
  private countdownEndsAt: number | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  /** First player to join is the host (may edit config before anyone readies). */
  private hostId: string | null = null;
  private activeGameProvider: (() => { summary: ActiveGameSummary; memberIds: string[] } | null) | null = null;

  constructor(
    instanceId: string,
    private readonly io: LobbyIo,
    private readonly options: Required<Pick<LobbyManagerOptions, 'countdownMs'>> &
      Pick<LobbyManagerOptions, 'onGameStart'>,
  ) {
    this.instanceId = instanceId;
  }

  get size(): number {
    return this.players.size;
  }

  /** Add or refresh a player (idempotent on reconnect by discordUserId). */
  addPlayer(identity: DiscordIdentity, socketId: string): void {
    const existing = this.players.get(identity.discordUserId);
    this.players.set(identity.discordUserId, {
      discordUserId: identity.discordUserId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      chipBalance: identity.chipBalance,
      isReady: existing?.isReady ?? false,
      socketId,
    });
    if (!this.hostId) this.hostId = identity.discordUserId;
    this.broadcast();
  }

  removeBySocket(socketId: string): boolean {
    const entry = [...this.players.values()].find((p) => p.socketId === socketId);
    if (!entry) return false;
    this.players.delete(entry.discordUserId);
    if (this.hostId === entry.discordUserId) {
      this.hostId = this.players.keys().next().value ?? null;
    }
    // If the countdown can no longer reach two ready players, cancel it.
    if (this.status === 'countdown' && this.readyPlayers().length < 2) {
      this.cancelCountdown();
    } else {
      this.broadcast();
    }
    return true;
  }

  setReady(socketId: string, ready: boolean): void {
    const player = this.bySocket(socketId);
    if (!player) return;
    player.isReady = ready;
    // Unreadying during a countdown cancels it (a ready player changed their mind).
    if (!ready && this.status === 'countdown') {
      this.cancelCountdown();
      return;
    }
    this.broadcast();
  }

  updateConfig(socketId: string, patch: Partial<TableConfig>): void {
    const player = this.bySocket(socketId);
    if (!player) return;
    // Host only, while waiting, before anyone has readied up.
    if (
      player.discordUserId !== this.hostId ||
      this.status !== 'waiting' ||
      this.readyPlayers().length > 0
    ) {
      return;
    }
    this.config = { ...this.config, ...sanitizeConfig(patch) };
    this.broadcast();
  }

  startCountdown(socketId: string): void {
    if (!this.bySocket(socketId)) return;
    if (this.status !== 'waiting') return;
    if (this.readyPlayers().length < 2) return;

    this.status = 'countdown';
    this.countdownEndsAt = Date.now() + this.options.countdownMs;
    this.io.to(this.instanceId).emit('countdown_start', { endsAt: this.countdownEndsAt });
    this.countdownTimer = setTimeout(() => this.finishCountdown(), this.options.countdownMs);
    this.broadcast();
  }

  cancelCountdown(socketId?: string): void {
    // A socket-initiated cancel is only honoured from a player who was ready.
    if (socketId) {
      const player = this.bySocket(socketId);
      if (!player) return;
    }
    if (this.status !== 'countdown') return;
    this.clearTimer();
    this.status = 'waiting';
    this.countdownEndsAt = null;
    this.io.to(this.instanceId).emit('countdown_cancel');
    this.broadcast();
  }

  private finishCountdown(): void {
    this.clearTimer();
    // Recompute at expiry so players who readied mid-countdown are included.
    const funded = this.readyPlayers().filter((p) => p.chipBalance >= this.config.buyIn);
    if (funded.length < 2) {
      this.status = 'waiting';
      this.countdownEndsAt = null;
      this.io.to(this.instanceId).emit('countdown_cancel');
      this.broadcast();
      return;
    }

    this.status = 'in-game';
    this.countdownEndsAt = null;
    const gameId = randomUUID();
    this.io.to(this.instanceId).emit('game_start', { gameId });
    this.broadcast();
    this.options.onGameStart?.(this, funded, gameId);
  }

  setActiveGameProvider(fn: (() => { summary: ActiveGameSummary; memberIds: string[] } | null) | null): void {
    this.activeGameProvider = fn;
  }

  /** Public re-broadcast hook (used when game membership changes). */
  broadcastState(): void {
    this.broadcast();
  }

  toState(): LobbyState {
    const active = this.activeGameProvider?.() ?? null;
    const tableIds = new Set(active?.memberIds ?? []);
    return {
      instanceId: this.instanceId,
      players: [...this.players.values()].filter((p) => !tableIds.has(p.discordUserId)),
      status: this.status,
      countdownEndsAt: this.countdownEndsAt,
      config: this.config,
      activeGame: active?.summary ?? null,
    };
  }

  private broadcast(): void {
    this.io.to(this.instanceId).emit('lobby_state_update', this.toState());
  }

  private readyPlayers(): LobbyPlayer[] {
    return [...this.players.values()].filter((p) => p.isReady);
  }

  private bySocket(socketId: string): LobbyPlayer | undefined {
    return [...this.players.values()].find((p) => p.socketId === socketId);
  }

  private clearTimer(): void {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}

const DEFAULT_COUNTDOWN_MS = 10_000;

export class LobbyManager {
  private readonly rooms = new Map<string, LobbyRoom>();
  private readonly opts: Required<Pick<LobbyManagerOptions, 'countdownMs'>> &
    Pick<LobbyManagerOptions, 'onGameStart'>;

  constructor(
    private readonly io: LobbyIo,
    options: LobbyManagerOptions = {},
  ) {
    this.opts = {
      countdownMs: options.countdownMs ?? DEFAULT_COUNTDOWN_MS,
      onGameStart: options.onGameStart,
    };
  }

  getOrCreate(instanceId: string): LobbyRoom {
    let room = this.rooms.get(instanceId);
    if (!room) {
      room = new LobbyRoom(instanceId, this.io, this.opts);
      this.rooms.set(instanceId, room);
    }
    return room;
  }

  get(instanceId: string): LobbyRoom | undefined {
    return this.rooms.get(instanceId);
  }
}

function sanitizeConfig(patch: Partial<TableConfig>): Partial<TableConfig> {
  const out: Partial<TableConfig> = {};
  if (isPositiveInt(patch.buyIn)) out.buyIn = patch.buyIn;
  if (isPositiveInt(patch.smallBlind)) out.smallBlind = patch.smallBlind;
  if (isPositiveInt(patch.bigBlind)) out.bigBlind = patch.bigBlind;
  if (isPositiveInt(patch.maxPlayers)) out.maxPlayers = Math.min(patch.maxPlayers, 9);
  if (isValidTurnSeconds(patch.turnSeconds)) out.turnSeconds = patch.turnSeconds;
  return out;
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function isValidTurnSeconds(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 10 &&
    n <= 120 &&
    n % 5 === 0
  );
}
