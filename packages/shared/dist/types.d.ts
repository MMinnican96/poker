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
    /** Seconds a player has to act before auto-fold/check. Host-configurable. */
    turnSeconds: number;
}
export declare const DEFAULT_TABLE_CONFIG: TableConfig;
export interface LobbyState {
    instanceId: string;
    players: LobbyPlayer[];
    status: LobbyStatus;
    countdownEndsAt: number | null;
    config: TableConfig;
    /** The player who created/hosts the pending game; null when no game is hosted. */
    hostId: string | null;
    /** Present when a game is running on this instance; null/absent otherwise. */
    activeGame?: ActiveGameSummary | null;
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
    /** Most recent action this street (display-only); null at hand start and each new street. */
    lastAction?: ActionType | null;
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
    /** People watching (no cards, not dealt). GameRoom-populated, not the engine. */
    spectators?: {
        discordUserId: string;
        displayName: string;
        avatarUrl: string;
    }[];
    /** True when the table idles with <2 seated players (no hand dealt). */
    waitingForPlayers?: boolean;
    /** This viewer's queued hand-boundary transition, stamped per recipient. */
    viewerPending?: 'leave' | 'spectate' | 'seat' | null;
    /** This viewer's authoritative bankroll (off-table chips), pushed live by the server. */
    viewerBankroll?: number;
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
/** All winning hand tiers, including Royal Flush (an ace-high straight flush). */
export type WonHandCategory = 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight' | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush' | 'royal-flush';
/**
 * One player's outcome for one hand — the append-only "fact" and the retrospective
 * source of truth. Produced by the server at hand end; also the shape returned by
 * the hand-history read API. `createdAt` is assigned by the DB on insert.
 */
export interface PlayerHandStat {
    gameId: string;
    playerId: string;
    handNumber: number;
    seatIndex: number;
    /** Seats clockwise from the button (0 = button). */
    position: number;
    chipsContributed: number;
    chipsWon: number;
    netResult: number;
    result: 'won' | 'lost' | 'folded';
    /** Hand shown at showdown; null if the player folded before showdown. */
    handCategory: WonHandCategory | null;
    potTotal: number;
    wentToShowdown: boolean;
    /** Voluntarily put money in pot (non-blind call/raise/all-in) pre-flop. */
    vpip: boolean;
    /** Put in a raise pre-flop. */
    pfr: boolean;
    aggressiveActions: number;
    passiveActions: number;
    wasAllIn: boolean;
    /** Last street the player was live on. */
    finalStreet: GamePhase;
    durationMs: number;
    createdAt?: string;
}
/** Metrics a leaderboard can rank by (maps to aggregate columns). */
export type LeaderboardMetric = 'net_profit' | 'chips_won' | 'hands_won' | 'biggest_pot_won' | 'hands_played';
/** One ranked row of a leaderboard. */
export interface LeaderboardEntry {
    playerId: string;
    displayName: string | null;
    metric: LeaderboardMetric;
    value: number;
    rank: number;
}
/**
 * A player's lifetime stats with derived ratios computed at read time
 * (never persisted). Raw counters mirror the `player_stats` aggregate row.
 */
export interface PlayerStatsSummary {
    playerId: string;
    handsPlayed: number;
    handsWon: number;
    handsLost: number;
    chipsBet: number;
    chipsWon: number;
    chipsLost: number;
    netProfit: number;
    biggestPotWon: number;
    showdownsWon: number;
    showdownsSeen: number;
    vpipCount: number;
    pfrCount: number;
    aggressiveActions: number;
    passiveActions: number;
    categoryCounts: Partial<Record<WonHandCategory, number>>;
    totalPlayMs: number;
    gamesPlayed: number;
    winRate: number;
    vpip: number;
    pfr: number;
    aggressionFactor: number;
    showdownWinRate: number;
}
export type TableRole = 'seated' | 'spectator';
/** A person at the table — cards-free, safe to show anyone (incl. lobby). */
export interface TableMember {
    discordUserId: string;
    displayName: string;
    avatarUrl: string;
    role: TableRole;
    chipStack: number;
    seatIndex: number | null;
}
/** Read-only snapshot of the active game, folded into LobbyState for lobby players. */
export interface ActiveGameSummary {
    gameId: string;
    handNumber: number;
    buyIn: number;
    maxPlayers: number;
    playingCount: number;
    spectatingCount: number;
    members: TableMember[];
    waitingForPlayers: boolean;
}
//# sourceMappingURL=types.d.ts.map