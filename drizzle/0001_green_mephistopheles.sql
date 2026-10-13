CREATE TYPE "public"."board_type" AS ENUM('fundkiste', 'biete-suche', 'pinnwand');--> statement-breakpoint
CREATE TABLE "board" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token" text NOT NULL,
	"type" "board_type" NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"category_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"contact" text,
	"delete_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_organizationId_idx" ON "board" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "note_boardId_expiresAt_idx" ON "note" USING btree ("board_id","expires_at");--> statement-breakpoint
CREATE INDEX "note_expiresAt_idx" ON "note" USING btree ("expires_at");