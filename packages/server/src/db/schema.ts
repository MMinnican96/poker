import {
  pgTable,
  text,
  integer,
  uuid,
  timestamp,
  jsonb,
  serial,
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

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Game = typeof games.$inferSelect;
export type ChipTransaction = typeof chipTransactions.$inferSelect;
