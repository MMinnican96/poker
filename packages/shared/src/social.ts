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

export type ActivityKind = 'big-win' | 'rare-hand' | 'level-up' | 'challenge' | 'achievement' | 'purchase' | 'table';

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
  /** Achievement unlock notices: the emblem to show next to the text. */
  emblem?: { achievementId: string; tier: number };
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
  trophies: ProfileTrophies;
  itemsOwned: number;
}

// ---------------------------------------------------------------------------
// Achievements (career challenges, feats, trophy cabinet)
// ---------------------------------------------------------------------------

/** Most emblems a player can pin to their trophy cabinet. */
export const SHOWCASE_MAX = 5;

/** A player's standing on one achievement. Names, goals and emblems come from the shared catalog. */
export interface AchievementProgress {
  id: string;
  progress: number;
  /** 0 = locked. */
  tier: number;
  /** One per tier reached, lowest first. ISO timestamps. */
  unlocks: { tier: number; unlockedAt: string }[];
}

/** `GET /api/achievements`: every achievement in the catalog (zeros when untouched) and the chosen showcase. */
export interface AchievementsResponse {
  achievements: AchievementProgress[];
  showcase: string[];
}

/** `PUT /api/achievements/showcase`. */
export type ShowcaseResult = { ok: true; showcase: string[] } | { ok: false; error: string };

/** One tier reached, already paid. */
export interface AchievementUnlock {
  playerId: string;
  achievementId: string;
  tier: number;
  chips: number;
  xp: number;
  /** The title this tier unlocked, if any. */
  titleId: string | null;
}

/** The trophy cabinet on a profile card. */
export interface ProfileTrophies {
  /** Emblems shown on the shelf, in order: the player's pick, or the automatic one. */
  showcase: string[];
  /** True when the player hasn't chosen and `showcase` is the automatic pick. */
  auto: boolean;
  /** Each unlocked achievement once, at its highest tier. */
  unlocked: { id: string; tier: number; unlockedAt: string }[];
  /** Number of achievements unlocked. */
  emblems: number;
  /** Catalog size. */
  total: number;
}

export type { Cosmetics };
