-- Server leases: seats remember which process opened them, so recovery only
-- refunds seats of processes that stopped heartbeating. Idempotent like 0000.
CREATE TABLE IF NOT EXISTS "server_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "table_seats" ADD COLUMN IF NOT EXISTS "lease_id" uuid;
