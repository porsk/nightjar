# 005 Search

Status: done
Milestone: M1

## Why
The owner must find old thoughts by any word, in typed text and in transcripts, even when Hungarian word endings or
missing accents differ from what was written (P-04).

## Scope
In (screen names from `design/alkony/m1.html`):
- **Search** (`search`, `searchempty`): search box with clear button, result count, result cards (date + time, source
  "szöveg" / "átirat", snippet with highlighted matches), no-results state.
- Postgres full-text search over entry body + all transcripts of the entry, Hungarian and English stemming,
  accent-insensitive (`unaccent`). `entries.search_vector` (architecture.md, "M1 data model") is kept current by database
  triggers, so no service has to remember it: they fire when an entry is inserted or its body changes, when a transcript is
  created, edited or deleted, and when a recording is deleted. The migration creates `unaccent` and fills the column for
  existing rows.
- API: `POST /api/v1/search` with the JSON body `{ "q": "…" }` → `{ total, results: [{ entryId, entryDate, createdAt, source, snippet }] }`,
  max 50 results. It is a POST on purpose: search words are journal text and must not appear in URLs, which reverse proxies
  write to their access logs (decision: owner, review of PR #45). `total` counts every match, the results are the best 50.

Out (not now): filters (M2), semantic search / "ask your journal" (backlog), search history, prefix or fuzzy matching.

## Acceptance criteria

- **AC-1** Given entries containing "költözésről", "költözéshez" and "költözés", when the user searches "költözés", then all three entries are found. (If the Postgres Hungarian stemmer disagrees on these words in the first test, swap in other suffixed forms that it handles; the intent is "word endings don't matter".)
- **AC-2** Given entries containing "költözés" and "napló", when the user searches "koltozes" or "naplo", then those entries are found.
- **AC-3** Given English entries containing "walked" and "walks", when the user searches "walking", then both are found.
- **AC-4** Given a word that is only in a transcript, then the entry is found and the card's source says "átirat"; a word only in the typed text shows "szöveg".
- **AC-5** Given the index, when the body is edited, a transcript arrives, a transcript is edited, or an entry is deleted, then the next search reflects the change.
- **AC-6** Given several matches, then there is one card per entry, ordered by rank and then newest first, each with date + time, source and a snippet around the match where the matched words are wrapped in `<mark>`; everything else in the snippet is escaped (a body with `<img src=x onerror=…>` shows as text); the count shows "N találat"; at most 50 cards.
- **AC-7** Given no match, then "Nincs találat" with the hint "Próbálj rövidebb vagy más szót. Az ékezetek nem számítanak." shows; given an empty query or fewer than 2 characters, then no request is sent and no results show.
- **AC-8** Given the search box, when the user types, then a request is sent 300 ms after the last keystroke; the clear (×) button empties the box and the results; opening a card opens that entry.
- **AC-9** Given user A and user B both have entries with the searched word, then A's search returns only A's entries.
- **AC-10** Given a query with search operators or quotes (`a & b`, `!x`, `"`, `'`, `:*`, `(`), then the API answers 200 (results or none), never 500.
- **AC-11** Given the results and the no-results state, then axe reports no violations on mobile and desktop, light and dark.
- **AC-12** Given the flows of this spec (search with a marker query, no results) run in a test with marker text (like `ZQX-PRIVATE-7781`) in every field and file name, then the marker appears nowhere in the captured log output (helper `apps/server/test/support/log-capture.ts`, spec 007).

## Test plan

Search tests run on real Postgres 19 (Testcontainers), since stemming and `unaccent` are the point.

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | | | three suffixed forms found | search "költözés" shows the seeded hits | HU fixture entries |
| AC-2 | | | unaccented queries match | | |
| AC-3 | | | English stems match | | EN fixture entries |
| AC-4 | | source label | `source` field per match | transcript-only hit after fake transcription | fake transcriber text |
| AC-5 | | | each change then search; look-alike apostrophes in an entry, a transcript and the upgrade backfill | | |
| AC-6 | snippet escaping, only `<mark>` survives | card render | order, max 50, total; 50 hits in 100 KB entries answer in under 1 s | | 60 matching entries, XSS body |
| AC-7 | | empty and short query: no fetch | | no-results screen | |
| AC-8 | | debounce with fake timers, clear button | | type → results → open entry | |
| AC-9 | | | two users, same word | | |
| AC-10 | | | each odd query → 200, including look-alike apostrophes (`ʻ ʼ ʹ ʽ ˈ ′ ŉ`) | | `websearch_to_tsquery`, no raw `to_tsquery` |
| AC-11 | | | | axe on both states | `emulateMedia({ colorScheme })` |
| AC-12 | | | marker through this spec's flows, assert absent from captured logs | | helper from spec 007 |

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
- The search vector lives in the `entries` row. Queries are not stored.
- The search words are journal text: they travel in the request body, never in a URL or a log line.

## Open questions
None. Every entry is indexed with both Hungarian and English stemming and search uses both (D-30 Q5).
