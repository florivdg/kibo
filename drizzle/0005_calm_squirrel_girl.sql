CREATE TABLE "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscription_boardId_endpoint_unique" UNIQUE("board_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "board" ADD COLUMN "push_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;