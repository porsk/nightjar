# M1 specs: summary

Status: approved by the owner (D-30, D-31), 2026-11-26. Reading time: about 6 minutes.

M1 "Speak and keep" in 8 specs, 115 acceptance criteria. Every AC has an automated test (unit, component, API on real
Postgres, or Playwright e2e). Transcription is faked in normal tests; the real model runs only in the release smoke test.

## The specs

| Spec | Delivers | ACs | Key test |
|---|---|---|---|
| [001 Setup + login](001-setup-login.md) | 3-step wizard (setup code from the container log + account, language + time zone, transcription now or later), first account is admin, login, logout, rate limit | 19 | e2e: fresh DB → code from log → wizard in `en` and `hu` → Home; API: two parallel setups, only one wins |
| [002 Text entries](002-text-entries.md) | Writer with autosave, plain Markdown (rendered when reading, no raw HTML), entry date dialog, edit, delete with files | 13 | e2e: write → reload → text kept; API: 23:30 UTC = next day in Budapest |
| [003 Voice entries](003-voice-entries.md) | Recorder, audio upload, background transcription with live status, edit transcript, retry, confirm before discarding, transcription off by default + model download with progress + "transcribe old recordings", one job at a time, model in memory only while working | 31 | e2e: HU and EN clips through the fake mic → "Átírás folyamatban…" → transcript appears |
| [004 Timeline](004-timeline.md) | Timeline by day with badges and infinite scroll, Home with today's entries, tab bar / sidebar | 12 | API: 75 entries paged with no gaps or duplicates; e2e: time zone switch keeps the day |
| [005 Search](005-search.md) | Full-text search over text + transcripts, Hungarian and English word endings, accents optional, highlighted snippets | 12 | API on real Postgres: "költözés" finds "költözésről", "naplo" finds "napló" |
| [006 Settings + HU/EN](006-settings.md) | UI language (English default), default recording language, time zone, account; every string in `hu` + `en`; system light/dark; installable PWA | 15 | e2e: walk every screen in `en`, no Hungarian text left (and the other way round) |
| [007 Logs, health, metrics](007-observability.md) | JSON logs with redaction, `/healthz`, `/readyz`, migrations on start, Prometheus `/metrics` on a separate internal port | 9 | API: test-only routes carry marker text through every log path; each other spec repeats the check for its real flows |
| [008 Backup guide](008-backup-guide.md) | `docs/backup.md`: back up, restore, before upgrading, Postgres major upgrade | 4 | nightly: run the guide's commands, wipe, restore, entry + audio are back |

Same in every spec: another user can never read or change your data (API test), axe on every new screen
(mobile + desktop, light + dark), both languages, screenshots of every mockup state.

Suggested build order (each step is one Sonnet task, reviewed before the next):

```
007 (migrations, readyz, logs) ─► 001 ─► 006 ─► 002 ─► 004 ─► 003 ─► 005 ─► 008
```

Not a spec: the CI upgrade test (D-29, previous release → new image on the same database) is its own M1 roadmap item, added right after the first release.

## Data model (M1)

Full version in `architecture.md`, section "M1 data model".

```
users ─< entries ─< recordings ─── transcripts (0 or 1)
instance_settings (one row)          jobs (pg-boss) carry userId + recordingId
```

| Table | What it holds |
|---|---|
| `users` | username, name, password (Better Auth), email (empty for now), `is_admin`, UI language, default recording language, time zone |
| `instance_settings` | transcription on / off (the only instance-wide setting) |
| `entries` | `user_id`, entry date, Markdown body, search index |
| `recordings` | `user_id`, entry, original file, length, language asked for, status (`pending`, `transcribing`, `done`, `failed`, `skipped`) |
| `transcripts` | `user_id`, recording, model, detected language, text, edited by user |

Audio: `/data/media/<user_id>/recordings/`. Model: `/data/models/`.

## Numbers I picked (say if you want different)

| What | Value |
|---|---|
| Password | at least 8 characters |
| Session | 7 days, renewed while you use it (Better Auth default) |
| Login rate limit | 10 failed tries per minute per IP |
| Autosave | 1 s after you stop typing |
| Entry date | any day up to today, no future days |
| Upload | up to 200 MB; webm, ogg, m4a/mp4/aac, mp3, wav, flac |
| Transcription retries | 2 retries, then "failed" with a retry button |
| Timeline | 30 entries per page |
| Search | from 2 characters, 300 ms after typing, top 50 results |
| First account's recording language | same as the UI language picked in setup (English by default) |
| Setup code | 8 random characters, new on every start while no account exists, printed to the container log |
| Metrics port | 9464 (`NIGHTJAR_METRICS_PORT`), not published |
| Nightly real-model check | word error rate under 30% on the English clip; language auto-detect on both |

## Answers (D-30)

| # | Question | Answer |
|---|---|---|
| 1 | First visitor becomes admin | B: one-time setup code in the container log, asked on wizard step 1 (001 AC-16 to 18) |
| 2 | Journals in M1 | A: none; the M2 migration creates a default journal per user |
| 3 | Entry title | A: no title in M1 |
| 4 | Language per recording | A: the recorder uses your default recording language |
| 5 | Search stemming | A: index and search with both Hungarian and English |
| 6 | Home greeting | A: by time of day |
| 7 | Discard on the recorder | B: confirm dialog (003 AC-4) |
| 8 | "Most nem" on the backlog question | A: hides it until Settings is opened again |
| 9 | Date of an uploaded memo | A: the file's last-modified date |
| 10 | `/metrics` | C: separate internal port, not published by default, scrape docs in engineering.md (007 AC-9, AC-10) |
| 11 | Forgotten password | A: nothing in M1, reset command is a backlog suggestion |
| 12 | Installable app | A: in M1, 2 ACs in 006 (AC-14, AC-15) |
| 13 | Entries per day | A: several per day, language on each recording |

D-31: English is the default UI language (setup wizard starts in English, new users get English, default recording
language follows the UI language). Labels quoted in the specs are the Hungarian mockup texts; every one has an English twin.

## Status flow

Specs go `draft` → `approved` → `building` → `done`. All 8 are `approved`. A spec's PR sets it to `building` together
with its tests, and to `done` when merged. `pnpm check:acs` enforces only `building` and `done`, so CI stays green
until a spec's PR adds its tests.
