CREATE TABLE IF NOT EXISTS "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"pin_price_snow" numeric DEFAULT '100' NOT NULL,
	"pin_duration_sec" integer DEFAULT 3600 NOT NULL,
	"pin_max" smallint DEFAULT 5 NOT NULL,
	"pin_payee" varchar(42) DEFAULT '0xEC11B5bd5f863b588a66A97C1Eda6c47010Ca751' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "app_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
