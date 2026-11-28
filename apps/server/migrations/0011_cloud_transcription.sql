CREATE TABLE "cloud_copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid,
	"recording_id" uuid,
	"vendor_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_secrets" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" RENAME COLUMN "active_model" TO "active_engine";--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "transcribed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "transcripts" SET "transcribed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "cloud_copies" ADD CONSTRAINT "cloud_copies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cloud_copies" ADD CONSTRAINT "cloud_copies_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcripts_model_time_idx" ON "transcripts" USING btree ("model","transcribed_at");