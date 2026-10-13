CREATE TABLE "hosted_subscription" (
	"user_id" text PRIMARY KEY NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"paid_until" timestamp with time zone,
	"complimentary" boolean DEFAULT false NOT NULL,
	"billing_name" text,
	"billing_address" text,
	"billing_email" text,
	"invoice_requested_at" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"reminder_stage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosted_subscription" ADD CONSTRAINT "hosted_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;