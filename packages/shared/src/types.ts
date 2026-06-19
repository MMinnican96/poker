export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'disconnected' | 'sitting-out';
export type GamePhase = 'waiting' | 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand-complete';
export type LobbyStatus = 'waiting' | 'countdown' | 'in-game';

export interface DiscordIdentity {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  chipBalance: number;
}

export interface LobbyPlayer {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  chipBalance: number;
  isReady: boolean;
  socketId: string;
}

export interface TableConfig {
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
}

export const DEFAULT_TABLE_CONFIG: TableConfig = {
  buyIn: 3000,
  smallBlind: 25,
  bigBlind: 50,
  maxPlayers: 9,
};

export interface LobbyState {
  instanceId: string;
  players: LobbyPlayer[];
  status: LobbyStatus;
  countdownEndsAt: number | null;
  config: TableConfig;
}

export interface GamePlayer {
  discordUserId: string;
  displayName: string;
  avatarUrl: string;
  seatIndex: number;
  chipStack: number;
  betThisRound: number;
  totalBetThisHand: number;
  holeCards: [Card, Card] | null;
  status: PlayerStatus;
  /** Whether this player has acted since the last bet/raise on the current street. */
  hasActed: boolean;
}

export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface GameState {
  gameId: string;
  instanceId: string;
  phase: GamePhase;
  players: GamePlayer[];
  communityCards: Card[];
  pots: Pot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  callAmount: number;
  minRaise: number;
  handNumber: number;
  config: TableConfig;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface PlayerAction {
  type: ActionType;
  amount?: number;
}

export interface HandResult {
  winnerId: string;
  winnerIds: string[];
  potAmount: number;
  handName?: string;
  cards?: Card[];
}
