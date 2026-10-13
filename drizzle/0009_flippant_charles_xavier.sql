CREATE TABLE "kita_link" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kita_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "board" DROP CONSTRAINT "board_token_unique";--> statement-breakpoint
ALTER TABLE "kita_link" ADD CONSTRAINT "kita_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board" DROP COLUMN "token";