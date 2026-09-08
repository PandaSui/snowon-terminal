ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "snowon_enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "chain_configs" ADD COLUMN IF NOT EXISTS "pons_enabled" boolean NOT NULL DEFAULT true;
