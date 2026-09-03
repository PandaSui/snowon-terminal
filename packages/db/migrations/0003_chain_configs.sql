CREATE TABLE IF NOT EXISTS "chain_configs" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"platform_id" varchar(32) DEFAULT 'snowon' NOT NULL,
	"name" text NOT NULL,
	"rpc_url" text NOT NULL,
	"ws_url" text,
	"factory" varchar(42) NOT NULL,
	"hook" varchar(42) NOT NULL,
	"registry" varchar(42) NOT NULL,
	"swap_router" varchar(42) NOT NULL,
	"pool_manager" varchar(42) NOT NULL,
	"deploy_block" bigint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
