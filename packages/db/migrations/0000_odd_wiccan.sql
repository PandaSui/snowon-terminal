CREATE TABLE "bundle_scores" (
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"score" smallint NOT NULL,
	"launch_block_buy_share" numeric(6, 4),
	"same_funder_share" numeric(6, 4),
	"creator_buy_share" numeric(6, 4),
	"top10_holder_share" numeric(6, 4),
	"detail" jsonb,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bundle_scores_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chain_id" integer NOT NULL,
	"room" varchar(42) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"holding_share_bps" integer,
	"content" text NOT NULL,
	"reply_to" bigint,
	"client_msg_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"username" varchar(32) NOT NULL,
	"avatar_url" text,
	"wallet_address" varchar(42),
	"wallet_chain_id" integer,
	"show_holdings" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "latest_prices" (
	"chain_id" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"price_eth" numeric(40, 18) NOT NULL,
	"graduation_progress" numeric(6, 4),
	"volume_24h_eth" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "latest_prices_chain_id_token_address_pk" PRIMARY KEY("chain_id","token_address")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"chain_id" integer NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"balance" numeric(78, 0) DEFAULT '0' NOT NULL,
	"cost_basis_eth" numeric(78, 0) DEFAULT '0' NOT NULL,
	"realized_pnl_eth" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_bought_eth" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_sold_eth" numeric(78, 0) DEFAULT '0' NOT NULL,
	"buy_count" integer DEFAULT 0 NOT NULL,
	"sell_count" integer DEFAULT 0 NOT NULL,
	"first_buy_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	CONSTRAINT "positions_chain_id_wallet_token_address_pk" PRIMARY KEY("chain_id","wallet","token_address")
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"platform_id" varchar(32) NOT NULL,
	"curve_address" varchar(42) NOT NULL,
	"creator" varchar(42) NOT NULL,
	"fee_receiver" varchar(42) NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"logo_uri" text,
	"quote_asset" varchar(42) NOT NULL,
	"quote_decimals" smallint DEFAULT 18 NOT NULL,
	"is_rwa" boolean DEFAULT false NOT NULL,
	"buy_tax_bps" smallint DEFAULT 0 NOT NULL,
	"sell_tax_bps" smallint DEFAULT 0 NOT NULL,
	"anti_snipe" boolean DEFAULT false NOT NULL,
	"anti_bundle" boolean DEFAULT false NOT NULL,
	"curve_p0" numeric(78, 0) NOT NULL,
	"curve_slope" numeric(78, 0) NOT NULL,
	"graduation_threshold" numeric(78, 0),
	"graduated" boolean DEFAULT false NOT NULL,
	"graduated_at" timestamp with time zone,
	"pool_id" varchar(66),
	"lp_locked_forever" boolean DEFAULT true NOT NULL,
	"created_at_block" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_tx" varchar(66) NOT NULL,
	CONSTRAINT "tokens_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"log_index" integer NOT NULL,
	"token_address" varchar(42) NOT NULL,
	"trader" varchar(42) NOT NULL,
	"is_buy" boolean NOT NULL,
	"eth_amount" numeric(78, 0) NOT NULL,
	"quote_amount" numeric(78, 0) NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"price_eth" numeric(40, 18) NOT NULL,
	"phase" varchar(8) NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp with time zone NOT NULL,
	CONSTRAINT "trades_chain_id_tx_hash_log_index_pk" PRIMARY KEY("chain_id","tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"chain_id" integer NOT NULL,
	"address" varchar(42) NOT NULL,
	"first_funder" varchar(42),
	"first_fund_tx" varchar(66),
	"first_fund_at" timestamp with time zone,
	"funder_label" varchar(16),
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wallets_chain_id_address_pk" PRIMARY KEY("chain_id","address")
);
--> statement-breakpoint
CREATE INDEX "chat_room_time_idx" ON "chat_messages" USING btree ("chain_id","room","created_at");--> statement-breakpoint
CREATE INDEX "chat_client_msg_idx" ON "chat_messages" USING btree ("user_id","client_msg_id");--> statement-breakpoint
CREATE INDEX "positions_token_idx" ON "positions" USING btree ("chain_id","token_address");--> statement-breakpoint
CREATE INDEX "tokens_chain_created_idx" ON "tokens" USING btree ("chain_id","created_at");--> statement-breakpoint
CREATE INDEX "tokens_chain_graduated_idx" ON "tokens" USING btree ("chain_id","graduated");--> statement-breakpoint
CREATE INDEX "trades_token_time_idx" ON "trades" USING btree ("chain_id","token_address","block_timestamp");--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "trades" USING btree ("chain_id","trader");--> statement-breakpoint
CREATE INDEX "wallets_first_funder_idx" ON "wallets" USING btree ("chain_id","first_funder");