CREATE TABLE IF NOT EXISTS "auth_nonces" (
	"nonce" varchar(64) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
