CREATE INDEX IF NOT EXISTS "tokens_chain_curve_idx" ON "tokens" ("chain_id","curve_address");
CREATE INDEX IF NOT EXISTS "tokens_chain_pool_idx" ON "tokens" ("chain_id","pool_id");
CREATE INDEX IF NOT EXISTS "trades_token_block_idx" ON "trades" ("chain_id","token_address","block_number");
CREATE INDEX IF NOT EXISTS "positions_token_bal_idx" ON "positions" ("chain_id","token_address","balance");
