CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP TRIGGER entries_search_vector ON entries;--> statement-breakpoint
DROP TRIGGER transcripts_search_vector ON transcripts;--> statement-breakpoint
DROP TRIGGER recordings_search_vector ON recordings;--> statement-breakpoint
DROP FUNCTION entries_set_search_vector();--> statement-breakpoint
DROP FUNCTION transcripts_refresh_search_vector();--> statement-breakpoint
DROP FUNCTION recordings_refresh_search_vector();--> statement-breakpoint
DROP FUNCTION refresh_entry_search_vector(uuid);--> statement-breakpoint
DROP FUNCTION entry_search_vector(uuid, text);--> statement-breakpoint
DROP FUNCTION nightjar_highlight_pattern(tsquery);--> statement-breakpoint
DROP FUNCTION nightjar_prefix_tsquery(tsquery);--> statement-breakpoint
DROP FUNCTION nightjar_tsquery(text);--> statement-breakpoint
DROP FUNCTION nightjar_tsvector(text);--> statement-breakpoint
DROP FUNCTION nightjar_unaccent_tsquery(tsquery);--> statement-breakpoint
DROP FUNCTION nightjar_unaccent_tsvector(tsvector);--> statement-breakpoint
DROP INDEX "entries_search_idx";--> statement-breakpoint
ALTER TABLE "entries" DROP COLUMN "search_vector";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE FUNCTION nightjar_search_text(content text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT lower(unaccent(content))
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_original_offset(content text, normalized_before int) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE
  total int := length(content);
  k int := least(normalized_before, total);
  below int;
  above int;
BEGIN
  FOR step IN 1..20 LOOP
    below := length(nightjar_search_text(left(content, k)));
    IF below > normalized_before THEN
      k := greatest(0, k - greatest(1, below - normalized_before));
    ELSIF k >= total THEN
      EXIT;
    ELSE
      above := length(nightjar_search_text(left(content, k + 1)));
      EXIT WHEN above > normalized_before;
      k := least(total, k + greatest(1, normalized_before - below));
    END IF;
  END LOOP;
  RETURN k;
END
$$;--> statement-breakpoint
CREATE FUNCTION entry_search_text(entry uuid, body text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nightjar_search_text(concat_ws(' ', body, (
    SELECT string_agg(transcripts.text, ' ')
    FROM entries
    JOIN recordings ON recordings.entry_id = entries.id AND recordings.user_id = entries.user_id
    JOIN transcripts ON transcripts.recording_id = recordings.id AND transcripts.user_id = entries.user_id
    WHERE entries.id = entry
  )))
$$;--> statement-breakpoint
CREATE FUNCTION entries_set_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := entry_search_text(NEW.id, NEW.body_md);
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER entries_search_text
BEFORE INSERT OR UPDATE OF body_md ON entries
FOR EACH ROW EXECUTE FUNCTION entries_set_search_text();--> statement-breakpoint
CREATE FUNCTION refresh_entry_search_text(entry uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM entries WHERE id = entry FOR UPDATE;
  UPDATE entries SET search_text = entry_search_text(id, body_md) WHERE id = entry;
END
$$;--> statement-breakpoint
CREATE FUNCTION transcripts_refresh_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_entry_search_text(
    (SELECT entry_id FROM recordings WHERE id = coalesce(NEW.recording_id, OLD.recording_id))
  );
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER transcripts_search_text
AFTER INSERT OR UPDATE OF text OR DELETE ON transcripts
FOR EACH ROW EXECUTE FUNCTION transcripts_refresh_search_text();--> statement-breakpoint
CREATE FUNCTION recordings_refresh_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_entry_search_text(OLD.entry_id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER recordings_search_text
AFTER DELETE ON recordings
FOR EACH ROW EXECUTE FUNCTION recordings_refresh_search_text();--> statement-breakpoint
UPDATE entries SET search_text = entry_search_text(id, body_md);--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search_text" gin_trgm_ops);
