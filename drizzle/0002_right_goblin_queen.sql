CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "spam_counter" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spam_fingerprint" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spam_key" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spam_counter_expiresAt_idx" ON "spam_counter" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "spam_fingerprint_expiresAt_idx" ON "spam_fingerprint" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "note_boardId_createdAt_idx" ON "note" USING btree ("board_id","created_at" desc,"id" desc);