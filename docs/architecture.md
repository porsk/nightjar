# Nightjar - architecture

Status: **draft for review** (2026-11-26). Nothing built yet. Rationale: `decisions.md`.
Tooling, testing, delivery: `engineering.md`. Scope: `product.md`.

**Guiding rule: simplest thing that works well.** No layer, package, service or abstraction until something
concrete needs it. Things deliberately left out are listed in §12.

## 1. Shape of the system

One container for the app, one for Postgres.

```
 Phone / desktop browser (PWA)                      AI clients (Claude Desktop / Code, …)
        │ REST /api/v1 · SSE /api/v1/events                │ MCP /mcp (token)
        ▼                                                  ▼
 ┌──────────────────────────── nightjar (one Node process) ───────────────────────────┐
 │ Fastify: serves the built PWA, REST API, SSE, MCP                                   │
 │ pg-boss job handlers in the same process:                                           │
 │   transcode (ffmpeg child process) → transcribe (sherpa-onnx in a child process)   │
 │   → enrich (AI, if enabled) · photos (sharp)                                         │
 └──────────────┬───────────────────────────────────────────────┬────────────────────┘
                │                                               │
              Postgres 19                              /data volume: media/, models/
```

- Heavy work never blocks requests: ffmpeg runs as a child process, transcription runs in its own child process (started when work arrives, ended when the queue is empty so the OS takes all model memory back),
  jobs are queued in Postgres (pg-boss) so they survive restarts and retry on failure.

## 2. Repository layout

```
apps/
  server/                Fastify app + job handlers
    src/
      main.ts            entry point: config → db → migrations → app → jobs
      config.ts          env vars, validated with Zod
      db/                Drizzle schema + migrations
      modules/           one folder per feature: routes.ts, service.ts, *.test.ts
      lib/               small shared helpers (logger, metrics, storage paths, events)
    test/                integration tests (Testcontainers)
  web/                   React PWA
    src/
      routes/            pages
      features/          recorder, entries, timeline, search, settings, …
      components/        shared UI components
      lib/               api client, i18n setup
    e2e/                 Playwright tests + audio fixtures
packages/
  shared/                Zod API schemas + types, i18n catalogues (hu, en), prompt library
eval/                    transcription evaluation script (clips git-ignored)
docker/                  Dockerfile, compose files
docs/
```

Three workspaces, plain pnpm workspace scripts. Modules are folders, not packages; they are added as features
arrive (M1 starts with `auth`, `entries`, `recordings`, `transcription`, `search`, `settings`).

## 3. Where abstraction is worth it (and only there)

Two small interfaces, because each has several real implementations **and** a fake for tests:

```ts
interface Transcriber {
  transcribe(wavPath: string, language: 'hu' | 'en' | 'auto'): Promise<Transcript> // text, language
  dispose(): void // frees the model; created when jobs start, disposed when the queue is empty
}
// M1: sherpa-onnx (Whisper large-v3-turbo int8 by default, D-20) + Fake.

interface AiProvider {
  enrichEntry(text: string, language: 'hu' | 'en'): Promise<EntrySuggestions> // summary, tags, people, places. Zod-validated
}
// M3: Anthropic (official @anthropic-ai/sdk, structured outputs), Ollama, Fake.
```

Everything else is plain functions and modules: services call Drizzle directly (no repository layer),
files go to the local filesystem (no storage interface), events are an in-process emitter.

## 4. Data model

```
users          id, username, email (nullable), name, locale, time_zone, created_at     (+ auth library's session tables)
access_tokens  id, user_id, name, token_hash, can_write, last_used_at, revoked_at
journals       id, user_id, name, is_default, created_at
entries        id, journal_id, entry_date (date), time_zone, title, body_md, language,
               mood (1-5), is_favourite, search_vector, created_at, updated_at
recordings     id, entry_id, file_path, mime_type, duration_ms, status, created_at
transcripts    id, recording_id, model, language, text, is_user_edited, updated_at
photos         id, entry_id, file_path, thumb_path, taken_at, created_at
tags, entry_tags (entry_id, tag_id, source 'user'|'ai')
prompts        id, user_id (null = built-in), text_hu, text_en
suggestions    id, entry_id, provider, model, payload (jsonb), status, created_at
```

- `entry_date` + `time_zone` drive look-backs, so "on this day" is right regardless of server time zone.
- `suggestions.provider` doubles as the record of "this entry was sent to Claude" - no separate audit table.
- Delete is a real delete (with confirmation), including files.
- Every table that holds user data also has a `user_id` (see "Ready for many users"). The sketch above is the
  long-term shape; M1 builds only the subset below.

### M1 data model

The one place the M1 specs (`docs/specs/001` to `007`) take their tables from. Later milestones add columns and
tables with forward-only migrations.

```
users ─< entries ─< recordings ─── transcripts (0 or 1)
instance_settings (one row, no user)       pg-boss jobs { userId, recordingId }
```

| Table | Key columns | Notes |
|---|---|---|
| `users` (+ Better Auth `sessions`, `accounts`, `verifications`) | id, `username` (unique, lowercase, 3 to 32 of `a-z 0-9 . - _`), `email` (nullable, unique, unused until OAuth or a hosted version), `name` (what we call the user), `is_admin`, `ui_language` (`hu`/`en`, default `en`), `entry_language` (`hu`/`en`/`auto`, starts equal to `ui_language`), `time_zone` (IANA), created_at | Per-user settings live on the user row. First account is the admin |
| `instance_settings` | id (always 1), `transcription_enabled` (default false), `auth_secret`, `setup_code_hash`, updated_at | The only instance-wide table, so no `user_id`. `auth_secret` is made on first start and signs session cookies. `setup_code_hash` holds the hash of the current setup code until the first account exists |
| `entries` | id (uuid), user_id, `entry_date` (date), `body_md` (text, may be empty), `search_vector` (tsvector, kept by database triggers), created_at, updated_at | Many entries per day. `entry_date` is the day it is about, never recomputed |
| `recordings` | id (uuid), user_id, entry_id, `file_path` (relative), mime_type, size_bytes, duration_ms, `language` (`hu`/`en`/`auto`, what was asked), `status`, created_at, updated_at | `status`: `pending`, `transcribing`, `done`, `failed`, `skipped` (transcription was off) |
| `transcripts` | id (uuid), user_id, recording_id (unique), `model`, `language` (`hu`/`en`, detected), `text`, `is_user_edited`, created_at, updated_at | One per recording. User edits are never overwritten |

- Indexes: `entries (user_id, entry_date desc, created_at desc, id)`, GIN on `entries.search_vector`,
  `recordings (entry_id)`, `recordings (status)`.
- Every query filters by the signed-in user's `user_id`. Another user's row answers 404, never 403, so ids don't leak.
- `entries.search_vector` is rebuilt by database triggers in the same transaction whenever the body of the entry changes, a transcript is created, edited or deleted, or a recording is deleted. The migration creates the `unaccent` extension and fills the column for existing rows.
- Files: `/data/media/<user_id>/recordings/<recording_id>.<ext>` (original upload, as is) and
  `/data/models/<model_id>/`. Only the storage module builds these paths.
- Live updates (SSE `/api/v1/events`, per user): `recording.updated { entryId, recordingId, status }`;
  admins also get `model.updated { state, downloadedBytes, totalBytes }`.
- Jobs: pg-boss queue `transcribe` (policy `short`, key = recording id, 2 retries), taken one at a time by `worker.ts`.
  The handler only works on recordings still `pending` or `transcribing`, so a duplicate job is a no-op, and a
  transcript the user edited is never overwritten. Job log lines carry `jobId` and the `requestId` that queued it.
- Live events are SSE frames named after the event (`event: recording.updated`, `event: model.updated`) fed by
  Postgres `NOTIFY` on channel `nightjar_events`; every web process `LISTEN`s and forwards to its own browsers.
- Data folder: `media/<user_id>/recordings/<id>.<ext>` (original), `models/<model_id>/` (model files),
  `models/<model_id>.<n>.part` (download in progress), `tmp/` (uploads and WAVs while a job runs, emptied after).
- The model download state (idle, downloading, failed) and its progress are saved in `instance_settings` (about once a second) and announced with `NOTIFY`, so any process can read them.
- Limits: uploads up to 200 MB and recordings up to 3 hours (one constant, `maxRecordingMs`), so a recording is never too big to hold in memory while it is transcribed. A job that runs longer than 5 times the audio length (at least 10 minutes) counts as stuck and is retried; on start, recordings left in `transcribing` are queued again.
- Not in M1: journals, title, mood, favourites, tags, photos, prompts, suggestions, access tokens, `entries.time_zone`
  (journals and title are open questions in `docs/specs/m1-summary.md`).

## 5. API

- REST + JSON under `/api/v1`. Zod schemas in `packages/shared` are used by Fastify for validation and by the
  web app for types - one source of truth, no code generation.
- Uploads: multipart, streamed to disk, size limits, file type checked by content (magic bytes).
- Live updates: one SSE stream per logged-in browser (`/api/v1/events`): transcript ready, job failed, etc.
- Errors: one consistent JSON shape `{ error: { code, message } }`; the UI maps `code` to an i18n key.

## 6. Transcription

1. Browser uploads the original recording (webm/opus or mp4/aac) → saved as-is, entry shows "Transcribing…".
2. Job: ffmpeg → temporary 16 kHz mono WAV.
3. Job: Silero VAD (built into sherpa-onnx; stops invented text on silence) → model → transcript → saved → temp WAV deleted → SSE event.
   Sherpa runs in its own child process, one at a time. It starts when a job needs it and ends when no job is
   waiting, so the OS gets all model memory back (about 1.8 GB peak, 130 MB idle). If the child dies, the waiting
   job fails and the next job starts a fresh child. Whisper is allowed 25 tokens per second of audio, because
   the default of 6 cuts Hungarian short.
4. If AI is enabled → enrichment job.

Transcription is off by default (D-23). When the admin turns it on in Settings, the model downloads
(checksum-verified, with progress) into `/data/models`, or is used as is if already there. Nothing is baked into the
image (hundreds of MB). A small JSON list in the repo names the supported models. Default model: Whisper large-v3-turbo
int8 (D-20); the final pick comes after the owner's own clips.

## 7. Search

Postgres full-text search: `search_vector` per entry from text + transcripts, built with both the `hungarian` and the `english` configuration (stemming: "költözésről" finds "költözés", "walked" finds "walking"). Accents are optional:
the vector holds each stem with and without accents, and the query is built the same way ("naplo" finds "napló"). `POST /api/v1/search` (words in the body, never in a URL) uses `websearch_to_tsquery`, so odd input never fails. Results are ranked,
one per entry, at most 50. Snippets are cut in the database (a 230 character window around the first match, `ts_headline` on the unaccented window); the server moves the marks onto the original text and escapes everything but `<mark>`. Lexemes are rewritten one by one (never in the serialized vector text), because `unaccent` turns some look-alike apostrophes into the quote character.

## 8. AI and MCP (M3, opt-in)

- **Configured by the admin in Settings** (D-24): provider (`off` | `anthropic` | `ollama`), model (Claude default
  `claude-opus-5-5`), API key or Ollama URL. The key is stored encrypted in the database; each user opts in for their own entries.
- Enrichment sends entry text and transcripts only (never audio or photos), gets Zod-validated structured output of summary, tags, people and places, stores it as a
  suggestion the user accepts or dismisses, in the entry's language. Entries show "processed by …".
- MCP: official TypeScript SDK, Streamable HTTP at `/mcp`, bearer token (read-only unless `can_write`).
  Tools call the same services as the REST API.

## 9. Web app

React 19 + Vite, React Router, TanStack Query for server data, react-i18next, `vite-plugin-pwa` (installable,
app shell cached). Recorder: `MediaRecorder` + Web Audio level meter + Wake Lock (screen stays on).
WCAG 2.2 AA. The app follows the system light/dark theme. Offline recording queue (IndexedDB) arrives in M4.

## 10. Security, privacy, operations

- Auth via Better Auth (MIT): username + password (Argon2id, username plugin), httpOnly SameSite cookies.
- `@fastify/helmet` (CSP, headers), `@fastify/rate-limit` on login/uploads.
- Non-root container; only `/data` writable. No telemetry; outbound traffic only for model downloads and opt-in AI.
- pino logs with redaction - never log journal text, transcripts or file names.
- HTTPS required for the microphone (except `localhost`): docs show Caddy / Traefik / Tailscale setups.
- Config via env vars validated at startup. Migrations run automatically on start.

## 11. Observability

No extra services. Everything is in the app process.

| What | How |
|---|---|
| Logs | pino, JSON to stdout, with redaction (no journal text, transcripts or file names) |
| Request id | Every request gets a random UUID `reqId` (an incoming `x-request-id` is ignored). It is returned in the `x-request-id` response header and is on every log line of that request. Jobs will log their `jobId` and the `requestId` of the request that enqueued them |
| Health | `/healthz` (process is up), `/readyz` (database reachable, migrations done) |
| Metrics | Prometheus `/metrics` using `prom-client` on a separate internal port (`NIGHTJAR_METRICS_PORT`, not published by default): request latency, job duration, transcription speed (real-time factor), queue depth |

## 12. Deliberately not doing

| Left out | Why |
|---|---|
| Separate worker container | One process is enough for one household |
| Repository layer, storage interface, DI container | Drizzle + filesystem directly are clear and testable |
| Turborepo / Nx | 3 workspaces, pnpm scripts suffice |
| OpenAPI generation | Shared Zod types cover our own client |
| Storybook | Component tests + Playwright screenshots cover it |
| Encrypted secrets in DB before M3 | Only the AI key needs it (D-24), so it arrives with M3 |
| Soft delete / trash | Confirmation dialog instead |
| Multiple transcription engines | One sherpa-onnx model |
| Event bus across processes | Single process → in-memory emitter |

## 13. M0 spikes

| Question | Check |
|---|---|
| Hungarian accuracy on the owner's voice | Eval harness, own clips |
| sherpa-onnx native addon on Node 26 / arm64 / slim image | Build the Docker image on both architectures |
| iOS PWA recording stops when the screen locks | Test on a real iPhone, report to the owner |
| CPU-only transcription speed | Measure in eval (real-time factor per model) |

## Ready for many users (not built yet)

The first version serves one person, but nothing should assume that. Later: family accounts on a homelab, OAuth
sign-in, maybe a hosted version.

| Rule | Why |
|---|---|
| Every table row (entries, audio, photos, tags, journals, jobs) has a `user_id`; every query filters by the signed-in user | Adding accounts later is a feature, not a rewrite |
| API tests check that one user can never read or change another user's data | Cheap now, critical later |
| Files live under per-user folders and are only touched through one storage module | Per-user quotas, backup or object storage later without hunting paths |
| Auth through Better Auth only; no hand-rolled sessions | OAuth providers are config + plugin, not new code |
| First account made in the setup wizard is the admin | Natural place for "invite people" later |
| Settings are per user (language, time zone); only server things (AI keys, models) are instance-wide | Each person keeps their own setup |
| Jobs carry the `user_id` and only need Postgres | Workers can move to their own process when a hosted version needs to scale |

## Ready to scale later (D-32)

No new services now. These rules keep a hosted version possible without a rewrite.

| Rule | Later it allows |
|---|---|
| Live events (e.g. "transcript ready") go through Postgres `LISTEN/NOTIFY`, never an in-process emitter | Several web containers behind a load balancer |
| Separate `web` and `worker` entry points in code; one process runs both today | Web and workers as separate containers from the same image |
| Every job is safe to retry or run twice | Many workers, crashes mid-job |
| Storage module takes keys, not file paths | Object storage (S3-style) instead of `/data` |
| No important state in process memory (login rate limit is the one exception) | Stateless web containers |
| Queue = pg-boss on Postgres, no broker | Swap is contained in one module if ever needed |

```
Today:   [ one container: web + worker ] ── Postgres ── /data
Later:   [ web ×N ] + [ worker ×M ] ── Postgres (queue + notify) ── object storage
```
