ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "lp_quote_wei" numeric(78, 0);
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "lp_token_wei" numeric(78, 0);
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "kind" varchar(12) DEFAULT 'buy' NOT NULL;
UPDATE "trades" SET "kind" = CASE WHEN "is_buy" THEN 'buy' ELSE 'sell' END;
