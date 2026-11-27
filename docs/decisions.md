| D-44 | 11-27 | M1 round 2 screens approved as they are (small differences from the mockups accepted). Claude may open and merge the pre-0.2.0 PRs and the 0.2.0 release PR once smoke test and CI are green | Owner |
| D-43 | 11-27 | Sign in with username + password instead of email (no email can be sent). Setup asks for a username, a name ("What should we call you?") and a password; the name is used in the greeting and can be changed in Settings. Email is not collected for now; it can be added later for OAuth or a hosted version. Breaking DB change is fine: nobody has installed 0.1.0 | Owner |
| D-40 | 11-27 | Maximum recording length 3 hours (recorder and uploads), file size limit stays 200 MB. Keeps transcription RAM around 3 GB peak on an 8 GB box. Behind Cloudflare proxy, uploads above 100 MB fail at Cloudflare | Owner has a 1.5 h recording |
| D-41 | 11-27 | No real-model accuracy check in nightly for now (Hungarian: one short clip is too noisy; English dropped too). The real model is exercised by the release smoke test | Owner |
| D-42 | 11-27 | Release 0.2.0 (voice + search) after a smoke test of the real image | Owner OK |
| D-38 | 11-26 | Visual checks: a side-by-side page (mockup vs real app, phone + desktop, dark + light, with a list of differences) for the owner after each round of screens; once the owner approves the real screens, Playwright reference screenshots (toHaveScreenshot) guard them against unintended changes | Owner |
| D-39 | 11-26 | Replaces the reference-screenshot part of D-38: no pixel reference images (too much churn while the UI grows). Instead, e2e has automatic layout checks (no sideways scroll, nothing clipped or overlapping) at phone and desktop width, and the owner reviews the side-by-side page after each round of screens | Owner |
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
| S-22 | Ready-made Grafana dashboard file in the repo | backlog (owner: good for later) |
| S-23 | Admin "System" page: queue length, transcription speed, recent errors | backlog (owner: good for later) |

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
| D-32 | 11-26 | Scale-ready from day one, no new services: live events go through Postgres LISTEN/NOTIFY (no in-process emitter for cross-request events); code has separate web and worker entry points, one process runs both for now; every job is safe to retry or run twice; storage module works with keys, not paths; no important state in process memory (login rate limit is the one accepted exception). No message broker | Owner: keep a later SaaS possible without a rewrite |
| D-33 | 11-26 | Before sign-in the UI follows the browser language (hu browser gets Hungarian), English otherwise | Owner |
| D-34 | 11-26 | First release 0.1.0 (release-please PR) once specs 001 + 002 are merged: you can log in and write. The CI upgrade test (D-29) starts from there. Claude may merge reviewed, green PRs; releases need the owner OK | Owner |
| D-35 | 11-26 | M1 build order with parallel rounds: 001, then a small fix so each e2e run picks its own free ports, then 002 ∥ 006, 003 ∥ 004, 005 ∥ 008. Each spec its own worktree, PR, review, merge | Owner OK |
| D-36 | 11-26 | Spec 001 engineering calls: auth secret generated on first start and stored in `instance_settings`; `NIGHTJAR_TRUST_PROXY` is a hop count for reverse proxies (the proxy must keep the Host header); global 300/min per-IP limit, 10/min on sign-in and setup; fonts bundled; only sign-in, sign-out and get-session exposed, sign-up off; setup code stored as a hash in `instance_settings`; the wizard's transcription-on saves the flag, the download comes with 003 | Orchestrator, owner informed |
| D-37 | 11-26 | Logo: the minimalist mockup bird (option A), `design/logo/nightjar.svg` | Owner pick |

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
