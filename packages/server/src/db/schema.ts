import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  uuid,
  timestamp,
  jsonb,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * players — one row per Discord user. `chip_balance` is the persistent bankroll
 * carried across games. New players are seeded with 10,000 chips on first login.
 */
export const players = pgTable('players', {
  discordUserId: text('discord_user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  chipBalance: integer('chip_balance').notNull().default(10_000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * games — a single table session, keyed externally by Discord `instance_id`.
 */
export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: text('instance_id').notNull(),
  status: text('status').notNull().default('active'),
  configJson: jsonb('config_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * game_players — membership + buy-in/cash-out accounting for a game session.
 */
export const gamePlayers = pgTable('game_players', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id')
    .notNull()
    .references(() => games.id),
  playerId: text('player_id')
    .notNull()
    .references(() => players.discordUserId),
  seatNumber: integer('seat_number').notNull(),
  buyInChips: integer('buy_in_chips').notNull(),
  finalChips: integer('final_chips'),
  status: text('status').notNull().default('active'),
});

/**
 * hands — one row per hand played within a game.
 */
export const hands = pgTable('hands', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id')
    .notNull()
    .references(() => games.id),
  handNumber: integer('hand_number').notNull(),
  pot: integer('pot').notNull().default(0),
  communityCardsJson: jsonb('community_cards_json').notNull().default([]),
  status: text('status').notNull().default('in-progress'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * hand_actions — ordered log of every action taken in a hand (audit + replay).
 */
export const handActions = pgTable('hand_actions', {
  id: serial('id').primaryKey(),
  handId: uuid('hand_id')
    .notNull()
    .references(() => hands.id),
  playerId: text('player_id')
    .notNull()
    .references(() => players.discordUserId),
  action: text('action').notNull(),
  amount: integer('amount').notNull().default(0),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * chip_transactions — append-only ledger of every chip movement against a
 * player's persistent balance. `idempotency_key` is UNIQUE so a retried or
 * duplicated write (e.g. socket reconnect replays) can never double-credit.
 */
export const chipTransactions = pgTable(
  'chip_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.discordUserId),
    amount: integer('amount').notNull(),
    type: text('type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyKeyUnique: uniqueIndex('chip_transactions_idempotency_key_unique').on(
      table.idempotencyKey,
    ),
  }),
);

/**
 * player_hand_stats — append-only fact table, one row per player per hand. The
 * retrospective source of truth for all statistics. `game_id` is the in-memory
 * game's uuid (no FK — the games/game_players audit tables are not written yet);
 * it groups rows and, with player_id + hand_number, forms the dedup key.
 */
export const playerHandStats = pgTable(
  'player_hand_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull(),
    playerId: text('player_id')
      .notNull()
      .references(() => players.discordUserId),
    handNumber: integer('hand_number').notNull(),
    seatIndex: integer('seat_index').notNull(),
    position: integer('position').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    handUnique: uniqueIndex('player_hand_stats_hand_unique').on(
      table.gameId,
      table.playerId,
      table.handNumber,
    ),
    playerCreatedIdx: index('player_hand_stats_player_created_idx').on(
      table.playerId,
      table.createdAt,
    ),
    gameIdx: index('player_hand_stats_game_idx').on(table.gameId),
  }),
);

/**
 * player_stats — denormalized aggregate counters, one row per player. Fast reads;
 * fully recomputable from player_hand_stats (except session-level total_play_ms /
 * games_played, which are not present in the fact table). bigint guards cumulative
 * sums against 32-bit overflow over a player's lifetime.
 */
export const playerStats = pgTable('player_stats', {
  playerId: text('player_id')
    .primaryKey()
    .references(() => players.discordUserId),
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
  vpipCount: integer('vpip_count').notNull().default(0),
  pfrCount: integer('pfr_count').notNull().default(0),
  aggressiveActions: integer('aggressive_actions').notNull().default(0),
  passiveActions: integer('passive_actions').notNull().default(0),
  categoryCounts: jsonb('category_counts').notNull().default({}),
  totalPlayMs: bigint('total_play_ms', { mode: 'number' }).notNull().default(0),
  gamesPlayed: integer('games_played').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Game = typeof games.$inferSelect;
export type ChipTransaction = typeof chipTransactions.$inferSelect;
export type PlayerHandStatRow = typeof playerHandStats.$inferSelect;
export type PlayerStatsRow = typeof playerStats.$inferSelect;
