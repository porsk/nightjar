# Decisions

Newest at the bottom. To change a decision, add a new entry that replaces the old one.

## Open (need the owner)

| # | Question | Options |
|---|---|---|
| O-5 | Speech recognition approach | Open. M0 eval compares options on accuracy (HU + EN), speed, hardware needs and cost. Free and local preferred. Owner decides from the report |
| O-6 | TypeScript 7 | Spike in M0. If it doesn't work with lint/test tools, bring it back to the owner |

## Requirements the owner asked for

Voice + typed entries · Hungarian and English recordings · offline transcription · HU/EN UI · Journiv-like
look-backs and prompts · photos attached to entries · AI via Claude first and local models to tag, extract
metadata and summarize transcribed entries · MCP server · self-hosted, Docker, pipeline publishing to Docker Hub ·
open source on GitHub · designed UI · automated tests (unit, UI, e2e) with a test plan in every spec ·
secure, current packages, observable, measurable.

Needed to make those work: login, list of entries (timeline), edit/delete, transcription model download,
language setting.

## Suggested features

Owner's answer (2026-11-26): **in scope** S-1, S-4, S-5, S-6, S-7, S-8, S-9. **Backlog:** the rest.

| # | Feature | Status |
|---|---|---|
| S-1 | Search (Hungarian-aware) | in scope |
| S-2 | Export zip + backup guide | backlog |
| S-3 | Import from Day One / Journiv / Markdown | backlog |
| S-4 | Mood | in scope |
| S-5 | Manual tags + filters (AI tags exist either way) | in scope |
| S-6 | Calendar view + gentle stats | in scope |
| S-7 | Multiple journals, favourites | in scope |
| S-8 | Upload an existing audio file | in scope |
| S-9 | Offline recording queue | in scope |
| S-10 | Share target, iOS Shortcut / Android widget | backlog |
| S-11 | Playback with word highlighting | backlog |
| S-12 | Ask your journal (semantic search + answers) | backlog |
| S-13 | Monthly summaries | backlog |
| S-14 | More users per instance (family) | backlog |
| S-15 | Passkeys | backlog |
| S-16 | AI photo captions | backlog |
| S-17 | Native app wrapper (Capacitor) | backlog |
| S-18 | Also publish images to GHCR | backlog |

## Decided

| # | Date | Decision | Why |
|---|---|---|---|
| D-01 | 11-24 | TypeScript everywhere, pnpm workspace (`server`, `web`, `shared`) | Owner is a TS dev. Python only for one-off tooling |
| D-02 | 11-24 | AGPL-3.0, DCO sign-off | Blocks closed SaaS forks, still fully open source |
| D-03 | 11-26 | GitHub `porsk/nightjar`, public | Owner created it |
| D-04 | 11-24 | Latest stable of everything (Node 26 LTS, pnpm 12) | Owner's rule. Check registries, Dependabot keeps it fresh |
| D-05 | 11-26 | Name: **Nightjar** | Bird that sings at dusk, plus a jar to keep things |
| D-06 | 11-26 | Keep it simple: no layer or tool until something needs it | Owner's rule |
| D-07 | 11-26 | Scope: asked-for features + S-1, S-4 to S-9. Rest is backlog | Owner's answer |
| D-08 | 11-26 | Dev: Postgres in Docker, Node + Vite on the host. Prod and e2e in Docker | Fast reloads on Windows |
| D-09 | 11-26 | Transcripts stored separately from entry text, tied to their audio | Keeps audio and text linked |
| D-10 | 11-26 | Images published to Docker Hub as `porsk/nightjar` only | Owner's Docker Hub account. GHCR not asked for |
| D-11 | 11-26 | Short backup guide (docs only) in M1. Export zip stays in backlog | Owner picked option A |
| D-12 | 11-26 | High-level plan approved. Speech recognition stays open until the eval | Owner |

## Proposed (approved together with the plan)

| # | Decision | Why |
|---|---|---|
| P-01 | One Node process (Fastify + pg-boss jobs) + Postgres 19, one Docker image | Simplest thing that works for a household. Heavy work runs in a child process / worker thread |
| P-02 | Fastify + Zod, schemas shared with the web app | Light, fast, one source of truth for types |
| P-03 | React + Vite PWA, React Router, TanStack Query | No SSR needed behind a login, PWA is simpler as an SPA |
| P-04 | Postgres full-text search with `hungarian`/`english` + `unaccent` | Hungarian stemming built in, no extra search service |
| P-05 | Speech recognition: decided after the M0 eval (O-5). Leading candidate: sherpa-onnx in Node (free, offline) | Avoids Python at runtime. Not locked in until the owner picks
| P-06 | Drizzle ORM, Better Auth | Typed SQL without magic; auth we don't write ourselves |
| P-07 | AI via env vars: Claude (default `claude-opus-5-5`), Ollama, or off | Standard self-hosted config, no secrets in the DB |
| P-08 | MCP server built in, token auth, read-only unless allowed | Owner uses Claude; one data path with the REST API |
| P-09 | Spec first, test first. Vitest, Testcontainers, Playwright | Owner's rule |
| P-10 | Docker Hub, amd64 + arm64, release-please | Easy install and upgrades, incl. Raspberry Pi |
| P-11 | Design as HTML mockups for review, no Figma or Storybook | No Figma access, keeps tooling small |
| P-12 | Server runs `.ts` directly with Node type stripping | No build step or tsx. Checked in the M0 spike, result goes to the owner |
| P-13 | Observability: pino JSON logs, `/healthz` + `/readyz`, Prometheus `/metrics` (request latency, job duration, transcription speed, queue depth) | Owner wants observable + measurable. No extra service |
