import type { HandCategory } from './hand-eval.js';
import type { LevelProgress } from './progression.js';
import type { Loadout, Cosmetics } from './shop.js';
import type { PublicPlayer, TableRules, TableStatus } from './table.js';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Everything the signed-in player knows about themselves. */
export interface PlayerSelf {
  id: string;
  name: string;
  avatarUrl: string;
  balance: number;
  xp: number;
  level: LevelProgress;
  loadout: Loadout;
  /** Owned item id → quantity (1 for permanent items). Free items are implied. */
  owned: Record<string, number>;
  daily: { available: boolean; streak: number; nextAmount: number };
  unreadMessages: number;
  unclaimedChallenges: number;
}

export interface AuthResponse {
  token: string;
  /** Present for the real Discord handshake. */
  accessToken?: string;
  me: PlayerSelf;
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

export type Presence = 'lobby' | 'playing' | 'watching';

export interface RoomMember extends PublicPlayer {
  presence: Presence;
  balance: number;
}

export interface TableSeatPreview {
  seat: number;
  player: (PublicPlayer & { stack: number }) | null;
}

export interface TableSummary {
  tableId: string;
  rules: TableRules;
  status: TableStatus;
  hostId: string | null;
  hostName: string | null;
  seats: TableSeatPreview[];
  spectatorCount: number;
  handsDealt: number;
}

export interface LobbyState {
  instanceId: string;
  members: RoomMember[];
  table: TableSummary | null;
}

// ---------------------------------------------------------------------------
// Activity + notices
// ---------------------------------------------------------------------------

export type ActivityKind = 'big-win' | 'rare-hand' | 'level-up' | 'challenge' | 'purchase' | 'table';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  playerId: string | null;
  playerName: string | null;
  text: string;
  at: number;
}

export interface Notice {
  id: string;
  tone: 'good' | 'info' | 'bad';
  title: string;
  body?: string;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const CHAT_MAX_LENGTH = 280;

/** `room:<instanceId>` or `dm:<idA>:<idB>` (ids sorted). */
export type ChannelId = string;

export function dmChannel(a: string, b: string): ChannelId {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

export function roomChannel(instanceId: string): ChannelId {
  return `room:${instanceId}`;
}

/** The other participant of a DM channel, from `me`'s side. */
export function dmPartner(channel: ChannelId, me: string): string | null {
  if (!channel.startsWith('dm:')) return null;
  const [, a, b] = channel.split(':');
  return a === me ? b : b === me ? a : null;
}

export interface ChatMessage {
  id: string;
  channel: ChannelId;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  body: string;
  createdAt: string;
}

export interface Conversation {
  channel: ChannelId;
  /** The other player, with their level and equipped cosmetics. */
  partner: PublicPlayer;
  last: ChatMessage | null;
  unread: number;
}

// ---------------------------------------------------------------------------
// Stats, leaderboard, profiles
// ---------------------------------------------------------------------------

export interface PlayerStatsSummary {
  playerId: string;
  handsPlayed: number;
  handsWon: number;
  handsLost: number;
  chipsBet: number;
  chipsWon: number;
  netProfit: number;
  biggestPotWon: number;
  showdownsWon: number;
  showdownsSeen: number;
  flopsSeen: number;
  vpipCount: number;
  pfrCount: number;
  aggressiveActions: number;
  passiveActions: number;
  categoryCounts: Partial<Record<HandCategory, number>>;
  totalPlayMs: number;
  sessionsPlayed: number;
  // Derived at read time:
  winRate: number;
  vpip: number;
  pfr: number;
  aggressionFactor: number;
  showdownWinRate: number;
}

/** One player's outcome for one hand — the append-only fact. */
export interface PlayerHandStat {
  tableId: string;
  playerId: string;
  handNumber: number;
  seat: number;
  /** Seats clockwise from the button among dealt-in players (0 = button). */
  position: number;
  bigBlind: number;
  chipsContributed: number;
  chipsWon: number;
  netResult: number;
  result: 'won' | 'lost' | 'folded';
  handCategory: HandCategory | null;
  potTotal: number;
  wentToShowdown: boolean;
  vpip: boolean;
  pfr: boolean;
  aggressiveActions: number;
  passiveActions: number;
  wasAllIn: boolean;
  finalStreet: 'pre-flop' | 'flop' | 'turn' | 'river' | 'showdown';
  durationMs: number;
  createdAt?: string;
}

export type LeaderboardMetric =
  | 'net_profit'
  | 'chips_won'
  | 'hands_won'
  | 'biggest_pot_won'
  | 'hands_played'
  | 'bankroll'
  | 'level';

export type LeaderboardPeriod = 'all' | 'week';

export const LEADERBOARD_METRICS: readonly { id: LeaderboardMetric; label: string; weekly: boolean }[] = [
  { id: 'net_profit', label: 'Net profit', weekly: true },
  { id: 'bankroll', label: 'Bankroll', weekly: false },
  { id: 'chips_won', label: 'Chips won', weekly: true },
  { id: 'hands_won', label: 'Hands won', weekly: true },
  { id: 'biggest_pot_won', label: 'Biggest pot', weekly: true },
  { id: 'hands_played', label: 'Hands played', weekly: true },
  { id: 'level', label: 'Level', weekly: false },
];

export interface LeaderboardEntry {
  rank: number;
  player: PublicPlayer;
  value: number;
}

/** `GET /api/leaderboard`: the top entries, plus your own place (null when you aren't ranked). */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
}

export interface ProfileCard extends PublicPlayer {
  level: number;
  levelProgress: LevelProgress;
  joinedAt: string;
  bankroll: number;
  stats: {
    handsPlayed: number;
    winRate: number;
    netProfit: number;
    biggestPotWon: number;
    bestHand: HandCategory | null;
    vpip: number;
    pfr: number;
    aggressionFactor: number;
    showdownWinRate: number;
    sessionsPlayed: number;
    totalPlayMs: number;
  };
  /** Net result of the last (up to) 20 hands, oldest first. */
  recentForm: number[];
  badges: Badge[];
  itemsOwned: number;
}

export type { Cosmetics };
