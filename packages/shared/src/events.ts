import type {
  LobbyState,
  GameState,
  PlayerAction,
  TableConfig,
  DiscordIdentity,
  TableRole,
} from './types.js';

export interface ServerToClientEvents {
  lobby_state_update: (state: LobbyState) => void;
  countdown_start: (data: { endsAt: number }) => void;
  countdown_cancel: () => void;
  game_start: (data: { gameId: string }) => void;
  game_state_update: (state: GameState) => void;
  timer_tick: (data: { playerId: string; remainingMs: number }) => void;
  action_rejected: (data: { reason: string }) => void;
  hand_result: (data: {
    winnerIds: string[];
    potAmount: number;
    handName?: string;
    finalState: GameState;
  }) => void;
  error: (data: { message: string }) => void;
  joined_table: (data: { gameId: string; role: TableRole }) => void;
  left_table: () => void;
}

export interface ClientToServerEvents {
  join_lobby: (data: { instanceId: string; identity: DiscordIdentity }) => void;
  player_ready: () => void;
  player_unready: () => void;
  start_countdown: () => void;
  cancel_countdown: () => void;
  update_config: (config: Partial<TableConfig>) => void;
  player_action: (action: PlayerAction) => void;
  leave_table: () => void;
  join_table: () => void;
  sit_in: () => void;
  sit_out: () => void;
  cancel_pending: () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  discordUserId: string;
  instanceId: string;
  displayName: string;
  avatarUrl: string;
  chipBalance: number;
}
