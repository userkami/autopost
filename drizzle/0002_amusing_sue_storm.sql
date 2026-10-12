CREATE TABLE "notification_email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_tick_ok" boolean DEFAULT true NOT NULL,
	"last_tick_error" text,
	"pending_jobs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "missed_notes" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_email_log" ADD CONSTRAINT "notification_email_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_email_log_user_id_idx" ON "notification_email_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_email_log_sent_at_idx" ON "notification_email_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "worker_heartbeats_last_tick_at_idx" ON "worker_heartbeats" USING btree ("last_tick_at");--> statement-breakpoint
CREATE INDEX "topics_blog_position_idx" ON "topics" USING btree ("blog_id","position");