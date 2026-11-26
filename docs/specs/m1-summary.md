# M1 specs: summary

Status: draft, waiting for the owner (2026-11-26). Reading time: about 8 minutes.

M1 "Speak and keep" in 8 specs, 103 acceptance criteria. Every AC has an automated test (unit, component, API on real
Postgres, or Playwright e2e). Transcription is faked in normal tests; the real model runs only nightly.

## The specs

| Spec | Delivers | ACs | Key test |
|---|---|---|---|
| [001 Setup + login](001-setup-login.md) | 3-step wizard (account, language + time zone, transcription now or later), first account is admin, login, logout, rate limit | 15 | e2e: fresh DB → wizard in `hu` and `en` → Home; API: two parallel setups, only one wins |
| [002 Text entries](002-text-entries.md) | Writer with autosave, plain Markdown (rendered when reading, no raw HTML), entry date dialog, edit, delete with files | 12 | e2e: write → reload → text kept; API: 23:30 UTC = next day in Budapest |
| [003 Voice entries](003-voice-entries.md) | Recorder, audio upload, background transcription with live status, edit transcript, retry, transcription off by default + model download with progress + "transcribe old recordings", one job at a time, model in memory only while working | 29 | e2e: HU and EN clips through the fake mic → "Átírás folyamatban…" → transcript appears |
| [004 Timeline](004-timeline.md) | Timeline by day with badges and infinite scroll, Home with today's entries, tab bar / sidebar | 12 | API: 75 entries paged with no gaps or duplicates; e2e: time zone switch keeps the day |
| [005 Search](005-search.md) | Full-text search over text + transcripts, Hungarian and English word endings, accents optional, highlighted snippets | 11 | API on real Postgres: "költözés" finds "költözésről", "naplo" finds "napló" |
| [006 Settings + HU/EN](006-settings.md) | UI language, default recording language, time zone, account; every string in `hu` + `en`; system light/dark | 12 | e2e: walk every screen in `en`, no Hungarian text left (and the other way round) |
| [007 Logs, health, metrics](007-observability.md) | JSON logs with redaction, `/healthz`, `/readyz`, migrations on start, Prometheus `/metrics` | 8 | API: marker text through every path, never in the logs |
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
| `users` | email, password (Better Auth), `is_admin`, UI language, default recording language, time zone |
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
| First account's recording language | same as the UI language picked in setup |
| Nightly real-model check | word error rate under 30% on each fixture clip |

## Open questions

| # | Question | Options | My pick |
|---|---|---|---|
| 1 | A fresh install accepts the first visitor as admin. Someone could get there before you | A) accept it, the README says "finish setup right after the first start" (Immich does this) · B) a one-time setup code printed in the container log, asked on step 1 | A |
| 2 | Journals are M2, but the data model hangs entries off a journal | A) no journals in M1; the M2 migration creates a default journal per user and moves entries in · B) create the default journal now | A |
| 3 | product.md lists an optional entry title; the approved mockups have none | A) no title in M1 · B) add a title field to the writer | A |
| 4 | Language per recording: the mockups only have a language choice on upload | A) the recorder uses your default recording language (pick "Automatikus" if you switch a lot) · B) add the Magyar / English / Automatikus choice to the recorder | A |
| 5 | Search stemming: typed text has no language, and one entry can mix both | A) index every entry with both Hungarian and English stemming, search both · B) stem with the user's default recording language | A |
| 6 | Home greeting ("Jó estét. Mi járt a fejedben?") | A) by time of day in your time zone: reggelt (5 to 10), napot (10 to 18), estét (18 to 5) · B) one fixed text | A |
| 7 | "Elvetés" on the recorder throws the audio away with one tap | A) as in the mockup, no confirmation · B) a small "Elveted a felvételt?" dialog | B |
| 8 | "Most nem" on "14 felvételt még nem írtunk át" | A) hides it until you open Settings again · B) hides it for good | A |
| 9 | Default date of an uploaded voice memo | A) the file's last-modified date, as the mockup suggests · B) today | A |
| 10 | `/metrics` has no user data but shows activity | A) open, like `/healthz`; docs say to block it at the reverse proxy · B) needs a token from an env var | A |
| 11 | Forgotten password: no email, no reset in M1 | A) nothing in M1, a reset command goes to the backlog as a suggestion · B) a command in the container that sets a new password, in M1 | A |
| 12 | Installable app (home-screen icon, cached app shell; `vite-plugin-pwa` is already in the plan) is not in the M1 list | A) add it to M1 (spec 006, 2 more ACs) · B) wait for M4 with the offline queue | A |

## Docs that disagree (to fix after your answers)

| Where | Says | But |
|---|---|---|
| D-24 vs P-07, architecture §8 and §12, plan-summary | AI provider and key set in Settings, stored encrypted | Elsewhere: env vars only, no secrets in the DB. D-24 is newer, so the others need updating before M3 |
| D-23 vs product.md §4 + §5 flow 1, architecture §6 | Transcription off by default, admin turns it on | Elsewhere: the model downloads on first start or first use. Specs follow D-23 and the mockups |
| D-20 vs architecture §6, plan-summary | Default model is Whisper turbo | Elsewhere: "chosen by the eval" / "Open". Specs use turbo |
| D-15 vs architecture §4 | Every row has a `user_id` | The §4 sketch leaves it out of entries, recordings, transcripts, photos. Fixed with a note + the M1 data model |
| product.md §3 vs mockups | "One journal entry for a day", entry has a language | Mockups show several entries per day and the language on each recording. Specs follow the mockups |

One process change: `pnpm check:acs` now skips specs with `Status: draft`, so these drafts don't turn CI red before
their tests exist. Approving a spec (status `approved`) switches the check on for it.
