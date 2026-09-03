CREATE TABLE IF NOT EXISTS "user_profiles" (
	"chain_id" integer NOT NULL,
	"wallet" varchar(42) NOT NULL,
	"username" varchar(32),
	"twitter" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_pkey" PRIMARY KEY("chain_id","wallet")
);
