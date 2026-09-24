import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uuid,
  timestamp,
  jsonb,
  date,
  doublePrecision,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

/**
 * players — one row per Discord user. `chip_balance` is the off-table bankroll;
 * chips at a table live in `table_seats` until cashed out. The equipped shop
 * cosmetics (loadout) live here too.
 */
export const players = pgTable(
  'players',
  {
  discordUserId: text('discord_user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  chipBalance: integer('chip_balance').notNull().default(10_000),
  xp: integer('xp').notNull().default(0),
  dailyStreak: integer('daily_streak').notNull().default(0),
  lastDailyClaim: date('last_daily_claim', { mode: 'string' }),
  loadoutFelt: text('loadout_felt').notNull().default('felt-classic'),
  loadoutCardBack: text('loadout_card_back').notNull().default('back-classic'),
  loadoutFrame: text('loadout_frame').notNull().default('frame-none'),
  loadoutTitle: text('loadout_title').notNull().default('title-none'),
  loadoutCelebration: text('loadout_celebration').notNull().default('cele-confetti'),
  /** Achievement ids pinned to the trophy cabinet, in order (empty = automatic pick). */
  showcase: text('showcase').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('players_chip_balance_non_negative', sql`${t.chipBalance} >= 0`)],
);

/**
 * chip_transactions — append-only ledger of every chip movement against a
 * player's bankroll. `idempotency_key` is UNIQUE so a retried write can never
 * apply twice.
 */
export const chipTransactions = pgTable(
  'chip_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    amount: integer('amount').notNull(),
    type: text('type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chip_transactions_idempotency_key_unique').on(t.idempotencyKey),
    index('chip_transactions_player_idx').on(t.playerId, t.createdAt),
  ],
);

/**
 * server_leases — one row per running server process (id = its boot id), kept
 * alive by a heartbeat. Seats opened by a process carry its lease, so recovery
 * only refunds seats whose process has stopped heartbeating — never those of a
 * process still serving them (e.g. the old instance during a rolling deploy).
 */
export const serverLeases = pgTable('server_leases', {
  id: uuid('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * table_seats — chips in escrow at a table. A buy-in moves chips from the
 * bankroll into an open seat row; every hand checkpoints the stack; cashing out
 * closes the row and credits the bankroll. Open rows whose process lease has
 * gone stale (or that predate leases) are refunded by recovery.
 */
export const tableSeats = pgTable(
  'table_seats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id').notNull(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    stack: integer('stack').notNull(),
    boughtIn: integer('bought_in').notNull(),
    status: text('status').notNull().default('open'),
    lastHand: integer('last_hand').notNull().default(0),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** The server process (lease) that opened the seat; null for legacy rows. */
    leaseId: uuid('lease_id'),
  },
  (t) => [
    uniqueIndex('table_seats_open_unique').on(t.tableId, t.playerId).where(sql`status = 'open'`),
    index('table_seats_status_idx').on(t.status),
    check('table_seats_stack_non_negative', sql`${t.stack} >= 0`),
  ],
);

/**
 * player_hand_stats — append-only fact table, one row per player per hand; the
 * retrospective source of truth for statistics and challenges. `game_id` holds
 * the table session id (no FK).
 */
export const playerHandStats = pgTable(
  'player_hand_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('game_id').notNull(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    handNumber: integer('hand_number').notNull(),
    seat: integer('seat_index').notNull(),
    position: integer('position').notNull(),
    bigBlind: integer('big_blind').notNull().default(0),
    chipsContributed: integer('chips_contributed').notNull(),
    chipsWon: integer('chips_won').notNull(),
    netResult: integer('net_result').notNull(),
    result: text('result').notNull(),
    handCategory: text('hand_category'),
    potTotal: integer('pot_total').notNull(),
    wentToShowdown: boolean('went_to_showdown').notNull(),
    vpip: boolean('vpip').notNull(),
    pfr: boolean('pfr').notNull(),
    aggressiveActions: integer('aggressive_actions').notNull(),
    passiveActions: integer('passive_actions').notNull(),
    wasAllIn: boolean('was_all_in').notNull(),
    finalStreet: text('final_street').notNull(),
    durationMs: integer('duration_ms').notNull(),
    // Newer facts (achievements). Null on rows recorded before they existed.
    playersDealt: integer('players_dealt'),
    startingStack: integer('starting_stack'),
    knockouts: integer('knockouts'),
    checkRaise: boolean('check_raise'),
    threeBet: boolean('three_bet'),
    allInPreflop: boolean('all_in_preflop'),
    behindOnTurn: boolean('behind_on_turn'),
    splitPot: boolean('split_pot'),
    showdownOpponents: integer('showdown_opponents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_hand_stats_hand_unique').on(t.tableId, t.playerId, t.handNumber),
    index('player_hand_stats_player_created_idx').on(t.playerId, t.createdAt),
    index('player_hand_stats_game_idx').on(t.tableId),
    index('player_hand_stats_created_idx').on(t.createdAt),
  ],
);

/**
 * player_stats — denormalized per-player aggregates for fast reads, rebuildable
 * from player_hand_stats (except the session columns).
 */
export const playerStats = pgTable('player_stats', {
  playerId: text('player_id').primaryKey().references(() => players.discordUserId),
  handsPlayed: integer('hands_played').notNull().default(0),
  handsWon: integer('hands_won').notNull().default(0),
  handsLost: integer('hands_lost').notNull().default(0),
  chipsBet: bigint('chips_bet', { mode: 'number' }).notNull().default(0),
  chipsWon: bigint('chips_won', { mode: 'number' }).notNull().default(0),
  chipsLost: bigint('chips_lost', { mode: 'number' }).notNull().default(0),
  netProfit: bigint('net_profit', { mode: 'number' }).notNull().default(0),
  biggestPotWon: integer('biggest_pot_won').notNull().default(0),
  showdownsWon: integer('showdowns_won').notNull().default(0),
  showdownsSeen: integer('showdowns_seen').notNull().default(0),
  flopsSeen: integer('flops_seen').notNull().default(0),
  vpipCount: integer('vpip_count').notNull().default(0),
  pfrCount: integer('pfr_count').notNull().default(0),
  aggressiveActions: integer('aggressive_actions').notNull().default(0),
  passiveActions: integer('passive_actions').notNull().default(0),
  categoryCounts: jsonb('category_counts').notNull().default({}),
  totalPlayMs: bigint('total_play_ms', { mode: 'number' }).notNull().default(0),
  gamesPlayed: integer('games_played').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * hand_history — one row per hand: board, pots and each dealt-in player's cards
 * and result. Opponents' unshown cards are filtered out when served.
 */
export const handHistory = pgTable(
  'hand_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableId: uuid('table_id').notNull(),
    handNumber: integer('hand_number').notNull(),
    board: jsonb('board').notNull(),
    pots: jsonb('pots').notNull(),
    players: jsonb('players').notNull(),
    playerIds: text('player_ids').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hand_history_hand_unique').on(t.tableId, t.handNumber),
    index('hand_history_players_idx').using('gin', t.playerIds),
  ],
);

/** player_items — owned shop items (quantity for consumables, 1 for permanents). */
export const playerItems = pgTable(
  'player_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    itemId: text('item_id').notNull(),
    quantity: integer('quantity').notNull().default(1),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_items_unique').on(t.playerId, t.itemId),
    check('player_items_quantity_non_negative', sql`${t.quantity} >= 0`),
  ],
);

/** player_challenges — progress on one challenge in one period. */
export const playerChallenges = pgTable(
  'player_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    periodKey: text('period_key').notNull(),
    challengeId: text('challenge_id').notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    /** Streak challenges: consecutive hits so far this period (progress is the best). */
    current: doublePrecision('current').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('player_challenges_unique').on(t.playerId, t.periodKey, t.challengeId)],
);

/**
 * player_achievements — progress on one career challenge or feat. `progress`
 * is the metric's running value (sum, best streak or max); `current` is the
 * streak in progress; `tier` is the highest tier paid out (0 = locked).
 */
export const playerAchievements = pgTable(
  'player_achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    achievementId: text('achievement_id').notNull(),
    progress: doublePrecision('progress').notNull().default(0),
    current: doublePrecision('current').notNull().default(0),
    tier: integer('tier').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_achievements_unique').on(t.playerId, t.achievementId),
    check('player_achievements_tier_range', sql`${t.tier} between 0 and 5`),
  ],
);

/**
 * player_achievement_unlocks — one row per tier reached. Unique per
 * (player, achievement, tier): only the insert that creates the row pays.
 */
export const playerAchievementUnlocks = pgTable(
  'player_achievement_unlocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    achievementId: text('achievement_id').notNull(),
    tier: integer('tier').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('player_achievement_unlocks_unique').on(t.playerId, t.achievementId, t.tier),
    index('player_achievement_unlocks_player_idx').on(t.playerId, t.unlockedAt),
  ],
);

/** app_meta — small key/value markers (e.g. one-time backfills that have run). */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/** chat_messages — room chat and direct messages. */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: text('channel').notNull(),
    senderId: text('sender_id').notNull().references(() => players.discordUserId),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_channel_idx').on(t.channel, t.createdAt)],
);

/** chat_reads — when a player last read a channel (for unread counts). */
export const chatReads = pgTable(
  'chat_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id').notNull().references(() => players.discordUserId),
    channel: text('channel').notNull(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('chat_reads_unique').on(t.playerId, t.channel)],
);

export type Player = typeof players.$inferSelect;
export type PlayerStatsRow = typeof playerStats.$inferSelect;
export type PlayerHandStatRow = typeof playerHandStats.$inferSelect;
