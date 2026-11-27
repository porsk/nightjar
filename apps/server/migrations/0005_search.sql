CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "search_vector" "tsvector" DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE FUNCTION nightjar_unaccent_tsvector(vector tsvector) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(
    '''' || replace(replace(unaccent(lexeme), '\', '\'), '''', '''''') || '''' ||
      coalesce(':' || array_to_string(positions, ','), ''),
    ' '), '')::tsvector
  FROM unnest(vector)
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_unaccent_tsquery(query tsquery) RETURNS tsquery
LANGUAGE plpgsql STABLE AS $$
DECLARE
  part text[];
  result text := '';
BEGIN
  FOR part IN SELECT regexp_matches(query::text, '''((?:[^'']|'''')*)''|([^'']+)', 'g') LOOP
    IF part[1] IS NOT NULL THEN
      result := result || '''' || replace(replace(
        unaccent(replace(replace(part[1], '''''', ''''), '\', '\')),
        '\', '\'), '''', '''''') || '''';
    ELSE
      result := result || part[2];
    END IF;
  END LOOP;
  RETURN result::tsquery;
END
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_tsvector(content text) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT nightjar_unaccent_tsvector(to_tsvector('hungarian', content))
    || to_tsvector('hungarian', unaccent(content))
    || nightjar_unaccent_tsvector(to_tsvector('english', content))
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_tsquery(terms text) RETURNS tsquery
LANGUAGE sql STABLE AS $$
  SELECT nightjar_unaccent_tsquery(websearch_to_tsquery('hungarian', terms))
    || websearch_to_tsquery('hungarian', unaccent(terms))
    || nightjar_unaccent_tsquery(websearch_to_tsquery('english', terms))
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_prefix_tsquery(query tsquery) RETURNS tsquery
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(query::text, '(''(?:[^'']|'''')*'')', '\1:*', 'g')::tsquery
$$;--> statement-breakpoint
CREATE FUNCTION nightjar_highlight_pattern(query tsquery) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  part text[];
  words text[] := '{}';
BEGIN
  FOR part IN SELECT regexp_matches(query::text, '''((?:[^'']|'''')*)''', 'g') LOOP
    words := words || regexp_replace(
      replace(replace(part[1], '''''', ''''), '\\', '\'), '([^[:alnum:]])', '\\\1', 'g');
  END LOOP;
  IF cardinality(words) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN '\m(' || array_to_string(words, '|') || ')';
END
$$;--> statement-breakpoint
CREATE FUNCTION entry_search_vector(entry uuid, body text) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT nightjar_tsvector(body) || coalesce((
    SELECT nightjar_tsvector(string_agg(transcripts.text, ' '))
    FROM entries
    JOIN recordings ON recordings.entry_id = entries.id AND recordings.user_id = entries.user_id
    JOIN transcripts ON transcripts.recording_id = recordings.id AND transcripts.user_id = entries.user_id
    WHERE entries.id = entry
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
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM entries WHERE id = entry FOR UPDATE;
  UPDATE entries SET search_vector = entry_search_vector(id, body_md) WHERE id = entry;
END
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
UPDATE entries SET search_vector = entry_search_vector(id, body_md);--> statement-breakpoint
CREATE INDEX "entries_search_idx" ON "entries" USING gin ("search_vector");
