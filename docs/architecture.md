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
 │   transcode (ffmpeg child process) → transcribe (sherpa-onnx in a worker thread)    │
 │   → enrich (AI, if enabled) · photos (sharp)                                         │
 └──────────────┬───────────────────────────────────────────────┬────────────────────┘
                │                                               │
              Postgres 19                              /data volume: media/, models/
```

- Heavy work never blocks requests: ffmpeg runs as a child process, transcription runs in a worker thread,
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
}
// M1: sherpa-onnx (model picked by the eval) + Fake.

interface AiProvider {
  enrichEntry(text: string, language: 'hu' | 'en'): Promise<EntrySuggestions> // summary, tags, people, places. Zod-validated
}
// M3: Anthropic (official @anthropic-ai/sdk, structured outputs), Ollama, Fake.
```

Everything else is plain functions and modules: services call Drizzle directly (no repository layer),
files go to the local filesystem (no storage interface), events are an in-process emitter.

## 4. Data model

```
users          id, email, display_name, locale, time_zone, created_at     (+ auth library's session tables)
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
4. If AI is enabled → enrichment job.

Models are downloaded on first start (checksum-verified) into `/data/models` - not baked into the image
(hundreds of MB). A small JSON list in the repo names the supported models. Default model: chosen by the eval (O-5).

## 7. Search

Postgres full-text search: `search_vector` per entry from title + text + transcripts (+ tags), built with the `hungarian` or `english` configuration (stemming: "kutyámmal" finds "kutya") plus
`unaccent` ("naplo" finds "napló"). Ranked results with highlighted snippets.

## 8. AI and MCP (M3, opt-in)

- **Configured by environment variables**, the normal self-hosted way: `ANTHROPIC_API_KEY`, `NIGHTJAR_AI_PROVIDER`
  (`off` | `anthropic` | `ollama`), `NIGHTJAR_AI_MODEL` (Claude default `claude-opus-5-5`), `OLLAMA_URL`.
  No API keys stored in the database → no encryption code to maintain.
- Enrichment sends entry text and transcripts only (never audio or photos), gets Zod-validated structured output of summary, tags, people and places, stores it as a
  suggestion the user accepts or dismisses, in the entry's language. Entries show "processed by …".
- MCP: official TypeScript SDK, Streamable HTTP at `/mcp`, bearer token (read-only unless `can_write`).
  Tools call the same services as the REST API.

## 9. Web app

React 19 + Vite, React Router, TanStack Query for server data, react-i18next, `vite-plugin-pwa` (installable,
app shell cached). Recorder: `MediaRecorder` + Web Audio level meter + Wake Lock (screen stays on).
WCAG 2.2 AA. The app follows the system light/dark theme. Offline recording queue (IndexedDB) arrives in M4.

## 10. Security, privacy, operations

- Auth via Better Auth (MIT): email + password (Argon2id), httpOnly SameSite cookies.
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
| Health | `/healthz` (process is up), `/readyz` (database reachable, migrations done) |
| Metrics | Prometheus `/metrics` using `prom-client`: request latency, job duration, transcription speed (real-time factor), queue depth |

## 12. Deliberately not doing

| Left out | Why |
|---|---|
| Separate worker container | One process is enough for one household |
| Repository layer, storage interface, DI container | Drizzle + filesystem directly are clear and testable |
| Turborepo / Nx | 3 workspaces, pnpm scripts suffice |
| OpenAPI generation | Shared Zod types cover our own client |
| Storybook | Component tests + Playwright screenshots cover it |
| Encrypted secrets in DB | Secrets live in env vars |
| Soft delete / trash | Confirmation dialog instead |
| Multiple transcription engines | One sherpa-onnx model |
| Event bus across processes | Single process → in-memory emitter |

## 13. M0 spikes

| Question | Check |
|---|---|
| Hungarian accuracy on the owner's voice | Eval harness, own clips |
| sherpa-onnx native addon on Node 26 / arm64 / slim image | Build the Docker image on both architectures |
| iOS PWA recording stops when the screen locks | Test on a real iPhone, report to the owner |
| TypeScript 7 (native compiler) vs lint/test tooling | Try it, report to the owner |
| CPU-only transcription speed | Measure in eval (real-time factor per model) |
