ALTER TABLE "instance_settings" ADD COLUMN "active_model" text DEFAULT 'whisper-large-v3-turbo-int8' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "model_download_id" text;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "model_download_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "model_download_error" text;--> statement-breakpoint
UPDATE "instance_settings" SET "model_download_id" = 'whisper-large-v3-turbo-int8' WHERE "model_download_state" <> 'idle';--> statement-breakpoint
UPDATE "instance_settings" SET "model_download_error" = 'download_failed' WHERE "model_download_state" = 'failed';
