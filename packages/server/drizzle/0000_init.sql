-- Baseline schema. Written to be idempotent so the same migration upgrades a
-- database created by the pre-overhaul `db:push` schema (existing tables keep
-- their data; new columns/constraints/indexes are added) and creates a fresh
-- database from scratch.

-- Pre-overhaul audit tables that were never written.
DROP TABLE IF EXISTS "hand_actions", "hands", "game_players", "games" CASCADE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"channel" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chip_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hand_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"hand_number" integer NOT NULL,
	"board" jsonb NOT NULL,
	"pots" jsonb NOT NULL,
	"players" jsonb NOT NULL,
	"player_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"period_key" text NOT NULL,
	"challenge_id" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_hand_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"hand_number" integer NOT NULL,
	"seat_index" integer NOT NULL,
	"position" integer NOT NULL,
	"big_blind" integer DEFAULT 0 NOT NULL,
	"chips_contributed" integer NOT NULL,
	"chips_won" integer NOT NULL,
	"net_result" integer NOT NULL,
	"result" text NOT NULL,
	"hand_category" text,
	"pot_total" integer NOT NULL,
	"went_to_showdown" boolean NOT NULL,
	"vpip" boolean NOT NULL,
	"pfr" boolean NOT NULL,
	"aggressive_actions" integer NOT NULL,
	"passive_actions" integer NOT NULL,
	"was_all_in" boolean NOT NULL,
	"final_street" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_items_quantity_non_negative" CHECK ("player_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_stats" (
	"player_id" text PRIMARY KEY NOT NULL,
	"hands_played" integer DEFAULT 0 NOT NULL,
	"hands_won" integer DEFAULT 0 NOT NULL,
	"hands_lost" integer DEFAULT 0 NOT NULL,
	"chips_bet" bigint DEFAULT 0 NOT NULL,
	"chips_won" bigint DEFAULT 0 NOT NULL,
	"chips_lost" bigint DEFAULT 0 NOT NULL,
	"net_profit" bigint DEFAULT 0 NOT NULL,
	"biggest_pot_won" integer DEFAULT 0 NOT NULL,
	"showdowns_won" integer DEFAULT 0 NOT NULL,
	"showdowns_seen" integer DEFAULT 0 NOT NULL,
	"flops_seen" integer DEFAULT 0 NOT NULL,
	"vpip_count" integer DEFAULT 0 NOT NULL,
	"pfr_count" integer DEFAULT 0 NOT NULL,
	"aggressive_actions" integer DEFAULT 0 NOT NULL,
	"passive_actions" integer DEFAULT 0 NOT NULL,
	"category_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_play_ms" bigint DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"chip_balance" integer DEFAULT 10000 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"daily_streak" integer DEFAULT 0 NOT NULL,
	"last_daily_claim" date,
	"loadout_felt" text DEFAULT 'felt-classic' NOT NULL,
	"loadout_card_back" text DEFAULT 'back-classic' NOT NULL,
	"loadout_frame" text DEFAULT 'frame-none' NOT NULL,
	"loadout_title" text DEFAULT 'title-none' NOT NULL,
	"loadout_celebration" text DEFAULT 'cele-confetti' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_chip_balance_non_negative" CHECK ("players"."chip_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "table_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"stack" integer NOT NULL,
	"bought_in" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_hand" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "table_seats_stack_non_negative" CHECK ("table_seats"."stack" >= 0)
);
--> statement-breakpoint
-- Columns new since the pre-overhaul schema.
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "xp" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "daily_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "last_daily_claim" date;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "loadout_felt" text DEFAULT 'felt-classic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "loadout_card_back" text DEFAULT 'back-classic' NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "loadout_frame" text DEFAULT 'frame-none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "loadout_title" text DEFAULT 'title-none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "loadout_celebration" text DEFAULT 'cele-confetti' NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN IF NOT EXISTS "flops_seen" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "big_blind" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "players" ADD CONSTRAINT "players_chip_balance_non_negative" CHECK ("players"."chip_balance" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_players_discord_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chip_transactions" ADD CONSTRAINT "chip_transactions_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_challenges" ADD CONSTRAINT "player_challenges_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_hand_stats" ADD CONSTRAINT "player_hand_stats_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_items" ADD CONSTRAINT "player_items_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "table_seats" ADD CONSTRAINT "table_seats_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_channel_idx" ON "chat_messages" USING btree ("channel","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_reads_unique" ON "chat_reads" USING btree ("player_id","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chip_transactions_idempotency_key_unique" ON "chip_transactions" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chip_transactions_player_idx" ON "chip_transactions" USING btree ("player_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hand_history_hand_unique" ON "hand_history" USING btree ("table_id","hand_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hand_history_players_idx" ON "hand_history" USING gin ("player_ids");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_challenges_unique" ON "player_challenges" USING btree ("player_id","period_key","challenge_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_hand_stats_hand_unique" ON "player_hand_stats" USING btree ("game_id","player_id","hand_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_hand_stats_player_created_idx" ON "player_hand_stats" USING btree ("player_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_hand_stats_game_idx" ON "player_hand_stats" USING btree ("game_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_hand_stats_created_idx" ON "player_hand_stats" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_items_unique" ON "player_items" USING btree ("player_id","item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "table_seats_open_unique" ON "table_seats" USING btree ("table_id","player_id") WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "table_seats_status_idx" ON "table_seats" USING btree ("status");
