# Decisions

Newest at the bottom. To change a decision, add a new entry that replaces the old one.

## Open (need the owner)

| # | Question | Options |
|---|---|---|
| O-5 | Speech recognition approach | Round 2 done (150 FLEURS sentences/lang, fairer scoring, `eval/reports/public-round2-2026-11-26.md`): Whisper turbo HU 15.5% / EN 5.2% WER at RTF 0.39; large-v3 13.6% and BuzzASR 12.4% HU but ~6x slower (RTF 2.2, 5 GB RAM); Canary 16.3%; Parakeet 30.9%. Lean: turbo. Owner decides after own clips + Soniox yardstick |

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
| S-19 | Keyboard shortcuts (desktop): R record, N new, / search, Ctrl+Enter save, Esc, J/K, ? | suggested, not M1 |
| S-20 | Plugins to extend the app (like Wealthfolio) | backlog, later milestone. Keep `Transcriber` / `AiProvider` as clean seams |
| S-21 | Public demo instance: log in and try it, sample data, reset on a schedule | backlog. Keep sample data as a seed script and allow a demo flag later |

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
| D-13 | 11-26 | Task tracking in GitHub: milestones M0 to M4, issues per WP / spec, labels. Docs keep decisions, requirements, specs | Owner asked for GitHub tracking |
| D-14 | 11-26 | TypeScript 6 (latest 6.x) everywhere for now. Move to TS 7 once typescript-eslint supports it | typescript-eslint refuses TS 7. Owner picked A |
| D-15 | 11-26 | Build for one user now, but architect for many: every row and file belongs to a user, every query scoped to the signed-in user, auth via Better Auth so OAuth providers can be added by config, no single-user shortcuts. Hosted (SaaS) version may come later, same code. Nothing of this is built before it is planned | Owner: family accounts on a homelab, OAuth and a hosted paid version later |
| D-16 | 11-26 | Design direction: **1 Alkony** (dusk: indigo night, amber glow, round amber record button). Desktop views next | Owner pick |
| D-17 | 11-26 | Speech eval round 2: fairer scoring, bigger sample, Whisper turbo vs large-v3 vs BuzzASR HU fine-tune vs Canary-1B-v2. Owner clips later | Owner: 20% WER not good enough |
| D-18 | 11-26 | Fast follow after round 2: Soniox as a cloud yardstick in the eval, piloted once the owner has an account | Owner |
| D-19 | 11-26 | CI checks PR titles are conventional commits. CodeQL runs as a workflow file, not the one-click setup | Owner OK |
| D-20 | 11-26 | Default speech model: Whisper large-v3-turbo (int8, sherpa-onnx). Final pick after owner clips + Soniox yardstick | Best speed/accuracy trade-off. Owner homelab: old 4-core i5, no GPU, 8 GB RAM shared with other services |
| D-21 | 11-26 | Hardware target = owner homelab (4 cores, 8 GB shared). Transcribe one job at a time; load the model only while jobs run | Turbo peaks ~2.5 GB RAM; must not starve other services |
| D-22 | 11-26 | Desktop: the sidebar record button is hidden on Home (big button is there) and while recording | Owner |
| D-23 | 11-26 | Transcription is optional, off by default. Admin turns it on in Settings: the model downloads to /data/models with progress (or is used as is if already there), then new recordings are transcribed, with an option to also transcribe recordings that were never transcribed. Off: voice entries keep audio only. Nothing baked into the image | Owner: plug and play, ship without it if not wanted |
| D-24 | 11-26 | AI is off by default. When it comes (M3), the admin sets the provider and API key in the Settings screen (stored encrypted); each user opts in for their own entries. Not planned before M3 | Owner: settings are easier; leave Claude out for now |
| D-25 | 11-26 | No keyboard shortcuts in M1; S-19 stays a suggestion | Owner OK |
| D-26 | 11-26 | Owner runs Nightjar behind a reverse proxy on an own (sub)domain with https. The iPhone test (WP6) uses that setup | Owner |
| D-27 | 11-26 | M1 mockups approved (`design/alkony/m1.html`): upload button on Home and entry, log out in Settings > Fiók, plain Markdown textarea (rendered when reading, no toolbar), 3-step wizard with download progress in Settings, mobile primary button at the bottom | Owner |
| D-28 | 11-26 | iPhone recording test moves to a later phase (owner has no iPhone; a friend may test when the app is close to ready) | Owner |
| D-29 | 11-26 | CI upgrade test, added right after the first release: start the previous release, save sample data, start the new image on the same database, check migrations ran and the data is intact | Owner: pulling a new version must just work |
| D-30 | 11-26 | M1 specs approved with these answers (m1-summary open questions): 1 B setup code from container log, 2 A, 3 A, 4 A, 5 A, 6 A, 7 B confirm discard, 8 A, 9 A, 10 C /metrics on a separate internal port not exposed by default, 11 A, 12 A installable PWA in M1, 13 A several entries per day | Owner: all looks good |
| D-31 | 11-26 | English is the default UI language: setup wizard starts in English (Hungarian can be picked), new users default to English. Default recording language follows the UI language picked | Owner: makes more sense for a shared project |

## Proposed (approved together with the plan)

| # | Decision | Why |
|---|---|---|
| P-01 | One Node process (Fastify + pg-boss jobs) + Postgres 19, one Docker image | Simplest thing that works for a household. Heavy work runs in a child process / worker thread |
| P-02 | Fastify + Zod, schemas shared with the web app | Light, fast, one source of truth for types |
| P-03 | React + Vite PWA, React Router, TanStack Query | No SSR needed behind a login, PWA is simpler as an SPA |
| P-04 | Postgres full-text search with `hungarian`/`english` + `unaccent` | Hungarian stemming built in, no extra search service |
| P-05 | Speech recognition: decided after the M0 eval (O-5). Leading candidate: sherpa-onnx in Node (free, offline) | Avoids Python at runtime. Not locked in until the owner picks
| P-06 | Drizzle ORM, Better Auth | Typed SQL without magic; auth we don't write ourselves |
| P-07 | AI: Claude (default `claude-opus-5-5`), Ollama, or off. The admin sets provider and API key in Settings, the key is stored encrypted (D-24) | Easier than env vars for the owner |
| P-08 | MCP server built in, token auth, read-only unless allowed | Owner uses Claude; one data path with the REST API |
| P-09 | Spec first, test first. Vitest, Testcontainers, Playwright | Owner's rule |
| P-10 | Docker Hub, amd64 + arm64, release-please | Easy install and upgrades, incl. Raspberry Pi |
| P-11 | Design as HTML mockups for review, no Figma or Storybook | No Figma access, keeps tooling small |
| P-12 | Server runs `.ts` directly with Node type stripping | No build step or tsx. Checked in the M0 spike, result goes to the owner |
| P-13 | Observability: pino JSON logs, `/healthz` + `/readyz`, Prometheus `/metrics` (request latency, job duration, transcription speed, queue depth) | Owner wants observable + measurable. No extra service |
