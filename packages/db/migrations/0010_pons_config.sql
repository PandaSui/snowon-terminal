ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "pons_factory" varchar(42);
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "pons_hook" varchar(42);
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "pons_deploy_block" bigint DEFAULT 0;
