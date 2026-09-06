CREATE TABLE IF NOT EXISTS "tracked_wallets" (
	"chain_id" integer NOT NULL,
	"owner" varchar(42) NOT NULL,
	"address" varchar(42) NOT NULL,
	"label" varchar(64),
	"note" text,
	"watching" boolean DEFAULT true NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracked_wallets_pkey" PRIMARY KEY("chain_id","owner","address")
);
CREATE INDEX IF NOT EXISTS "tracked_wallets_owner_idx" ON "tracked_wallets" ("chain_id","owner");
