import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@poker/shared';
import { LobbyManager, type LobbyRoom, type LobbyManagerOptions } from './lobby.js';
import { GameRoom, type ChipService, type StatsService, type GameTiming } from './game.js';

type LobbyIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type LobbySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export { LobbyManager, LobbyRoom } from './lobby.js';
export { GameRoom, type ChipService, type StatsService, noopChipService, noopStatsService } from './game.js';

export interface SocketHandlerOptions extends LobbyManagerOptions {
  /** Chip ledger for buy-ins/cash-outs. Production binds this to the DB. */
  chips?: ChipService;
  /** Stats writer for per-hand facts + aggregates. Production binds this to the DB. */
  stats?: StatsService;
  /** Turn/tick/hand-delay timing (short in tests). */
  gameTiming?: GameTiming;
}

/**
 * Wire the full socket protocol (lobby + game) onto an io server. Returns the
 * LobbyManager for inspection. Game sessions are created when a lobby countdown
 * completes, and player actions are routed to the matching GameRoom.
 */
export function registerSocketHandlers(io: LobbyIo, options: SocketHandlerOptions = {}): LobbyManager {
  const games = new Map<string, GameRoom>();

  const lobbies = new LobbyManager(io, {
    ...options,
    onGameStart: (room, players, gameId) => {
      const config = room.toState().config;
      const game = new GameRoom({
        io,
        gameId,
        instanceId: room.instanceId,
        config,
        players: players.map((p) => ({
          discordUserId: p.discordUserId,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          socketId: p.socketId,
          bankroll: p.chipBalance,
        })),
        chips: options.chips,
        stats: options.stats,
        timing: { ...options.gameTiming, turnMs: options.gameTiming?.turnMs ?? config.turnSeconds * 1000 },
        onEnd: (id) => {
          if (games.get(room.instanceId)?.gameId === id) games.delete(room.instanceId);
          const lr = lobbies.get(room.instanceId);
          lr?.setActiveGameProvider(null);
          lr?.resetAfterGame();
        },
      });
      games.set(room.instanceId, game);
      const lobbyRoom = lobbies.get(room.instanceId);
      lobbyRoom?.setActiveGameProvider(() => ({ summary: game.summary(), memberIds: game.memberIds() }));
      game.onMembershipChange = () => lobbyRoom?.broadcastState();
      void game.start();
      options.onGameStart?.(room, players, gameId);
    },
  });

  io.on('connection', (socket: LobbySocket) => {
    socket.on('join_lobby', ({ instanceId, identity }) => {
      if (!instanceId || !identity?.discordUserId) return;
      socket.data.instanceId = instanceId;
      socket.data.discordUserId = identity.discordUserId;
      socket.data.displayName = identity.displayName;
      socket.data.avatarUrl = identity.avatarUrl;
      socket.data.chipBalance = identity.chipBalance;

      void socket.join(instanceId);
      lobbies.getOrCreate(instanceId).addPlayer(identity, socket.id);

      // If a game is already running, treat this as a reconnect to that seat.
      games.get(instanceId)?.reconnect(identity.discordUserId, socket.id);
    });

    socket.on('player_ready', () => withLobby(socket, (room) => room.setReady(socket.id, true)));
    socket.on('player_unready', () => withLobby(socket, (room) => room.setReady(socket.id, false)));
    socket.on('start_countdown', () => withLobby(socket, (room) => room.startCountdown(socket.id)));
    socket.on('cancel_countdown', () =>
      withLobby(socket, (room) => room.cancelCountdown(socket.id)),
    );
    socket.on('update_config', (patch) =>
      withLobby(socket, (room) => room.updateConfig(socket.id, patch)),
    );
    socket.on('create_game', (config) =>
      withLobby(socket, (room) => room.createGame(socket.id, config)),
    );
    socket.on('cancel_game', () => withLobby(socket, (room) => room.cancelGame(socket.id)));

    socket.on('player_action', (action) => {
      const game = gameFor(socket);
      if (game && socket.data.discordUserId) game.handleAction(socket.data.discordUserId, action);
    });
    socket.on('leave_table', () => {
      const game = gameFor(socket);
      if (game && socket.data.discordUserId) game.leave(socket.data.discordUserId);
    });

    socket.on('join_table', () => {
      const game = gameFor(socket);
      if (!game || !socket.data.discordUserId) return;
      game.addSpectator({
        discordUserId: socket.data.discordUserId,
        displayName: socket.data.displayName,
        avatarUrl: socket.data.avatarUrl,
        socketId: socket.id,
        bankroll: socket.data.chipBalance ?? 0,
      });
    });
    socket.on('sit_in', () => routeMember(socket, (g, id) => g.requestSeat(id)));
    socket.on('sit_out', () => routeMember(socket, (g, id) => g.moveToSpectate(id)));
    socket.on('cancel_pending', () => routeMember(socket, (g, id) => g.cancelPending(id)));

    socket.on('disconnect', () => {
      withLobby(socket, (room) => room.removeBySocket(socket.id));
      gameFor(socket)?.handleDisconnect(socket.id);
    });
  });

  function withLobby(socket: LobbySocket, fn: (room: LobbyRoom) => void) {
    const instanceId = socket.data.instanceId;
    if (!instanceId) return;
    const room = lobbies.get(instanceId);
    if (room) fn(room);
  }

  function gameFor(socket: LobbySocket): GameRoom | undefined {
    const instanceId = socket.data.instanceId;
    return instanceId ? games.get(instanceId) : undefined;
  }

  function routeMember(socket: LobbySocket, fn: (g: GameRoom, id: string) => void) {
    const game = gameFor(socket);
    if (game && socket.data.discordUserId) fn(game, socket.data.discordUserId);
  }

  return lobbies;
}
