-- Achievements: career challenges, feats, titles and the trophy cabinet.
-- Idempotent like 0000/0001, so re-running it (or running it over a database
-- that already has some of it) changes nothing.
CREATE TABLE IF NOT EXISTS "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_achievement_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"achievement_id" text NOT NULL,
	"tier" integer NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"achievement_id" text NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"current" double precision DEFAULT 0 NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_achievements_tier_range" CHECK ("player_achievements"."tier" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "player_challenges" ADD COLUMN IF NOT EXISTS "current" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "players_dealt" integer;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "starting_stack" integer;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "knockouts" integer;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "check_raise" boolean;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "three_bet" boolean;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "all_in_preflop" boolean;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "behind_on_turn" boolean;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "split_pot" boolean;
--> statement-breakpoint
ALTER TABLE "player_hand_stats" ADD COLUMN IF NOT EXISTS "showdown_opponents" integer;
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "showcase" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_tier_range" CHECK ("player_achievements"."tier" between 0 and 5);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_achievement_unlocks" ADD CONSTRAINT "player_achievement_unlocks_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_players_discord_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("discord_user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_achievement_unlocks_unique" ON "player_achievement_unlocks" USING btree ("player_id","achievement_id","tier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_achievement_unlocks_player_idx" ON "player_achievement_unlocks" USING btree ("player_id","unlocked_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_achievements_unique" ON "player_achievements" USING btree ("player_id","achievement_id");
