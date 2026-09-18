ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "fast_wrapper" varchar(42);
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "fast_hook" varchar(42);
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "fast_deploy_block" bigint DEFAULT 0;
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "fast_enabled" boolean NOT NULL DEFAULT true;
