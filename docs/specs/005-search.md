# 005 Search

Status: in progress
Milestone: M1

## Why
The owner must find old thoughts by any part of a word, in typed text and in transcripts, even when Hungarian word
endings or accents differ from what was written (P-04, D-46).

## Scope
In (screen names from `design/alkony/m1.html`):
- **Search** (`search`, `searchempty`): search box with clear button, result count, result cards (date + time, source
  "szöveg" / "átirat", snippet with highlighted matches), no-results state.
- Substring search (`pg_trgm`) over entry body + all transcripts of the entry: a word matches anywhere inside a word,
  case-insensitive and accent-insensitive (`unaccent`). No stemming (D-46). `entries.search_text` (lower + unaccent of the
  body and all transcripts, architecture.md, "M1 data model") is kept current by database triggers, so no service has to
  remember it: they fire when an entry is inserted or its body changes, when a transcript is created, edited or deleted,
  and when a recording is deleted. A GIN trigram index serves the `LIKE` matching. The migration creates `pg_trgm`, fills the
  column for existing rows and drops the old full-text column and functions.
- The query is split on whitespace; an entry matches when every word appears somewhere in its text or transcripts.
  Double quotes are ignored. `%`, `_` and `\` are plain characters. Matches are marked exactly where the words were found, with the accents as written.
- API: `POST /api/v1/search` with the JSON body `{ "q": "…" }` → `{ total, results: [{ entryId, entryDate, createdAt, source, snippet }] }`,
  max 50 results. It is a POST on purpose: search words are journal text and must not appear in URLs, which reverse proxies
  write to their access logs (decision: owner, review of PR #45). `total` counts every match, the results are the newest 50.

Out (not now): filters (M2), semantic search / "ask your journal" (backlog), search history, fuzzy matching (typos), stemming, ranking by relevance.

## Acceptance criteria

- **AC-1** Given entries containing "költözésről", "költözéshez" and "költözés", when the user searches "költöz" or "költözés", then all three entries are found.
- **AC-2** Given entries containing "költözés" and "napló", when the user searches "koltozes", "KOLTOZES" or "naplo", then those entries are found.
- **AC-3** Given English entries containing "walked", "walks" and "walking", when the user searches "walk", then all three are found.
- **AC-4** Given a word that is only in a transcript, then the entry is found and the card's source says "átirat"; a word only in the typed text shows "szöveg".
- **AC-5** Given the index, when the body is edited, a transcript arrives, a transcript is edited, or an entry is deleted, then the next search reflects the change.
- **AC-6** Given several matches, then there is one card per entry, ordered newest first (entry date, then created time), each with date + time, source and a snippet around the match where the matched words are wrapped in `<mark>`; everything else in the snippet is escaped (a body with `<img src=x onerror=…>` shows as text); the count shows "N találat"; at most 50 cards.
- **AC-7** Given no match, then "Nincs találat" with the hint "Próbálj rövidebb vagy más szót. Az ékezetek nem számítanak." shows; given an empty query or fewer than 2 characters, then no request is sent and no results show.
- **AC-8** Given the search box, when the user types, then a request is sent 300 ms after the last keystroke; the clear (×) button empties the box and the results; opening a card opens that entry.
- **AC-9** Given user A and user B both have entries with the searched word, then A's search returns only A's entries.
- **AC-10** Given a query with search operators, quotes or wildcard characters (`a & b`, `!x`, `"`, `'`, `:*`, `(`, `%`, `_`, `\`), then the API answers 200 (results or none), never 500; `%`, `_` and `\` match literally, never as wildcards.
- **AC-11** Given the results and the no-results state, then axe reports no violations on mobile and desktop, light and dark.
- **AC-12** Given the flows of this spec (search with a marker query, no results) run in a test with marker text (like `ZQX-PRIVATE-7781`) in every field and file name, then the marker appears nowhere in the captured log output (helper `apps/server/test/support/log-capture.ts`, spec 007).
- **AC-13** Given the search box with text in it, then only the app's clear button shows; the browser's own clear button is hidden.
- **AC-14** Given an entry "Hello, ez egy első bejegyzés.", when the user searches "beje", "jegy" or "egyz", then it is found; given an entry with "születésnap", searching "nap" finds it.
- **AC-15** Given the entry "Hello, ez egy első bejegyzés.", when the user searches "egy", then every "egy" in the snippet is marked, including the one inside "bejegyzés"; searching "elso" marks "első" with its accents shown as written.
- **AC-16** Given several words in the query, then an entry is found only if every word appears somewhere in its text or transcripts, in any order; each word is marked.

## Test plan

Search tests run on real Postgres 19 (Testcontainers), since `pg_trgm` and `unaccent` are the point.

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | three suffixed forms found by a stem and by the full word | search "költözés" shows the seeded hits | HU fixture entries |
| AC-2 | | | unaccented and upper case queries match | | |
| AC-3 | | | English word starts match | | EN fixture entries |
| AC-4 | | source label | `source` field per match | transcript-only hit after fake transcription | fake transcriber text |
| AC-5 | | | each change then search; look-alike apostrophes in an entry, a transcript and the migration backfill | | |
| AC-6 | snippet escaping, only `<mark>` survives | card render | newest first, max 50, total; 50 hits in 100 KB entries answer in under 1 s | | 60 matching entries, XSS body |
| AC-7 | | empty and short query: no fetch | | no-results screen | |
| AC-8 | | debounce with fake timers, clear button | | type → results → open entry | |
| AC-9 | | | two users, same word | | |
| AC-10 | | | each odd query → 200, including look-alike apostrophes (`ʻ ʼ ʹ ʽ ˈ ′ ŉ`) | | `%`, `_`, `\` match literally; parameters only, no built SQL |
| AC-11 | | | | axe on both states | `emulateMedia({ colorScheme })` |
| AC-12 | | | marker through this spec's flows, assert absent from captured logs | | helper from spec 007 |
| AC-13 | | | | search box computed style and clear button | |
| AC-14 | | | middle-of-word queries find the entries | | |
| AC-15 | marks on repeated and accented matches, length-changing unaccent (ß, æ) | | snippet of the "egy" and "elso" queries | | |
| AC-16 | marks for several words, overlapping matches merge | | all words needed, any order, across text and transcript | | |

Also covered: both languages, mobile + desktop, screenshots of `search` and `searchempty`.

## i18n
New keys, in both `hu` and `en`.

| Key | hu | en |
|---|---|---|
| `search.title` / `.label` / `.clear` | Keresés / Keresés / Törlés | Search / Search / Clear |
| `search.count` | {{count}} találat | {{count}} result / {{count}} results (plural forms) |
| `search.source.text` / `.transcript` | szöveg / átirat | text / transcript |
| `search.empty.title` / `.hint` | Nincs találat / Próbálj rövidebb vagy más szót. Az ékezetek nem számítanak. | No results / Try a shorter or different word. Accents don't matter. |

## Privacy & data
- The search text lives in the `entries` row. Queries are not stored.
- The search words are journal text: they travel in the request body, never in a URL or a log line.

## Open questions
None. Stemming was dropped on purpose in favour of matching anywhere inside a word (D-46).
