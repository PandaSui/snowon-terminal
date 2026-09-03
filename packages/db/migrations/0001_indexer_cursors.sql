CREATE TABLE "indexer_cursors" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"last_block" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
