CREATE TABLE IF NOT EXISTS "admin_wallets" (
	"address" varchar(42) PRIMARY KEY NOT NULL,
	"added_by" varchar(42),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
