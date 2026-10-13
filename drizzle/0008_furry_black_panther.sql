CREATE TYPE "public"."report_case_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."report_notification_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'offensive', 'personal-data', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_resolution" AS ENUM('removed', 'kept');--> statement-breakpoint
CREATE TABLE "note_report" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"reason" "report_reason" NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_case" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"board_id" text NOT NULL,
	"note_id" text,
	"note_category_id" text NOT NULL,
	"note_title" text NOT NULL,
	"note_body" text NOT NULL,
	"note_author" text NOT NULL,
	"note_contact" text,
	"note_created_at" timestamp with time zone NOT NULL,
	"note_expires_at" timestamp with time zone NOT NULL,
	"status" "report_case_status" DEFAULT 'open' NOT NULL,
	"report_count" integer DEFAULT 1 NOT NULL,
	"first_reported_at" timestamp with time zone NOT NULL,
	"last_reported_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"resolution" "report_resolution"
);
--> statement-breakpoint
CREATE TABLE "report_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "report_notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"claimed_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_notification_case_user_unique" UNIQUE("case_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "note_report" ADD CONSTRAINT "note_report_case_id_report_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."report_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_case" ADD CONSTRAINT "report_case_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_case" ADD CONSTRAINT "report_case_board_id_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_case" ADD CONSTRAINT "report_case_note_id_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."note"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_case" ADD CONSTRAINT "report_case_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notification" ADD CONSTRAINT "report_notification_case_id_report_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."report_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notification" ADD CONSTRAINT "report_notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_notification" ADD CONSTRAINT "report_notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_report_caseId_idx" ON "note_report" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_case_open_note_idx" ON "report_case" USING btree ("note_id") WHERE "report_case"."status" = 'open';--> statement-breakpoint
CREATE INDEX "report_case_organizationId_status_idx" ON "report_case" USING btree ("organization_id","status","last_reported_at");--> statement-breakpoint
CREATE INDEX "report_case_boardId_idx" ON "report_case" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "report_case_firstReportedAt_idx" ON "report_case" USING btree ("first_reported_at");--> statement-breakpoint
CREATE INDEX "report_case_closedAt_idx" ON "report_case" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "report_notification_due_idx" ON "report_notification" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "report_notification_recipient_idx" ON "report_notification" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "report_notification_userId_idx" ON "report_notification" USING btree ("user_id");