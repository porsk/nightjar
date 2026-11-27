CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "search_vector" "tsvector" DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search_vector");--> statement-breakpoint
CREATE FUNCTION nightjar_tsvector(content text) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT unaccent(to_tsvector('hungarian', content)::text)::tsvector
    || to_tsvector('hungarian', unaccent(content))
    || unaccent(to_tsvector('english', content)::text)::tsvector
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_tsquery(terms text) RETURNS tsquery
LANGUAGE sql STABLE AS $$
  SELECT unaccent(websearch_to_tsquery('hungarian', terms)::text)::tsquery
    || websearch_to_tsquery('hungarian', unaccent(terms))
    || unaccent(websearch_to_tsquery('english', terms)::text)::tsquery
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_prefix_tsquery(query tsquery) RETURNS tsquery
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(query::text, '(''(?:[^'']|'''')*'')', '\1:*', 'g')::tsquery
$$;--> statement-breakpoint
CREATE FUNCTION entry_search_vector(entry uuid, body text) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT nightjar_tsvector(body) || coalesce((
    SELECT nightjar_tsvector(string_agg(transcripts.text, ' '))
    FROM transcripts
    JOIN recordings ON recordings.id = transcripts.recording_id
    WHERE recordings.entry_id = entry
  ), '')
$$;--> statement-breakpoint
CREATE FUNCTION entries_set_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := entry_search_vector(NEW.id, NEW.body_md);
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER entries_search_vector
BEFORE INSERT OR UPDATE OF body_md ON entries
FOR EACH ROW EXECUTE FUNCTION entries_set_search_vector();--> statement-breakpoint
CREATE FUNCTION refresh_entry_search_vector(entry uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE entries SET search_vector = entry_search_vector(id, body_md) WHERE id = entry
$$;--> statement-breakpoint
CREATE FUNCTION transcripts_refresh_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_entry_search_vector(
    (SELECT entry_id FROM recordings WHERE id = coalesce(NEW.recording_id, OLD.recording_id))
  );
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER transcripts_search_vector
AFTER INSERT OR UPDATE OF text OR DELETE ON transcripts
FOR EACH ROW EXECUTE FUNCTION transcripts_refresh_search_vector();--> statement-breakpoint
CREATE FUNCTION recordings_refresh_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_entry_search_vector(OLD.entry_id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER recordings_search_vector
AFTER DELETE ON recordings
FOR EACH ROW EXECUTE FUNCTION recordings_refresh_search_vector();--> statement-breakpoint
UPDATE entries SET search_vector = entry_search_vector(id, body_md);
