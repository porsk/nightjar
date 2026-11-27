ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
WITH cleaned AS (
  SELECT id, created_at, regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '_', 'g') AS raw
  FROM "users"
), padded AS (
  SELECT id, created_at, left(CASE WHEN length(raw) < 3 THEN rpad(raw, 3, '_') ELSE raw END, 32) AS base
  FROM cleaned
), ranked AS (
  SELECT id, base, row_number() OVER (PARTITION BY base ORDER BY created_at, id) AS position
  FROM padded
)
UPDATE "users" SET "username" = CASE
  WHEN ranked.position = 1 THEN ranked.base
  ELSE left(ranked.base, 31 - length(ranked.position::text)) || '-' || ranked.position::text
END
FROM ranked WHERE "users".id = ranked.id;--> statement-breakpoint
UPDATE "users" SET "name" = "username";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
