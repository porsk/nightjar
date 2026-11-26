# Nightjar: engineering plan

How we build, test and ship. Status: draft for review (2026-11-26).

## Versions (checked against the registries on 2026-11-26)

We use the latest stable release of everything. Before adding or bumping a dependency, check the registry,
don't go from memory. Dependabot keeps us current after that.

| What | Version |
|---|---|
| Node | 26.13 LTS (managed with nvm, pinned in `.nvmrc`) |
| pnpm | 12.23 (pinned with `packageManager` in `package.json`) |
| TypeScript | 6.0 (latest 6.x; typescript-eslint does not support 7 yet, see D-14) |
| Postgres | 19 (`postgres:19` image) |
| Docker base image | `node:26` slim, Debian trixie |
| Server | Fastify 5.12, Zod 4.6, Drizzle ORM 0.45 + drizzle-kit 0.31, pg-boss 12.40, Better Auth 1.7 (+ @node-rs/argon2 2.2 for Argon2id), pino 10, prom-client 15.1 |
| Server plugins | @fastify/helmet 13, @fastify/rate-limit 11, @fastify/multipart 10, @fastify/static 10 |
| Media / speech | sherpa-onnx-node 2.0, sharp 0.35, ffmpeg (Debian package) |
| AI / MCP | @anthropic-ai/sdk 1.14, @modelcontextprotocol/sdk 1.32 |
| Web | React 19.3, Vite 8.3, React Router 8.5, TanStack Query 5.108, i18next 27 + react-i18next 18, vite-plugin-pwa 2.0 |
| Tests | Vitest 5.1, Testing Library (React 16, jest-dom 8, user-event 14), jsdom 31, Playwright 1.65, Testcontainers 12.2, @axe-core/playwright 4.14 |
| Lint / format | ESLint 10 + typescript-eslint 8.74 + react-hooks plugin, Prettier 3.10 |

All licenses are MIT / Apache-2.0 / ISC / MPL-2.0 (test-only), which are fine with AGPL-3.0.

## Repo basics

- pnpm workspace with `apps/server`, `apps/web`, `packages/shared`. Root scripts run things across all of them
  (`pnpm -r`). No Turborepo.
- ESM only, TypeScript strict, `erasableSyntaxOnly` (no enums or other TS-only runtime syntax).
- **The server runs TypeScript directly with Node** (built-in type stripping, on by default in Node 26). No `tsx`,
  no build step for the server, fast restarts with `node --watch`. Type checking is a separate `tsc --noEmit` step.
  Confirmed in the M0 spike.
- The web app is built by Vite. In production Fastify serves the built files.

## Code style

- Code should read on its own: clear names, small functions, early returns. Comments only where the logic is
  genuinely tricky. Short doc comments on exported functions are fine. No ticket numbers, decision references
  or history in code.
- Named exports, no default exports (except where a tool needs one, like config files).
- Validate at the edges with Zod (HTTP input, env vars, AI output). Inside, trust the types.
- Errors: throw an `AppError` with a stable `code`, one Fastify error handler turns it into
  `{ error: { code, message } }`.
- File names in kebab-case. Tests next to the code (`entries.service.test.ts`), integration tests in `test/`.
- Prettier formats, ESLint (typescript-eslint `strictTypeChecked`) catches real problems. Format on save in the editor;
  CI enforces both. No git hooks to start with.

## How a feature gets built

1. **Spec.** Write `docs/specs/NNN-name.md` from the template: why, scope, acceptance criteria (`AC-1`…), test
   plan, i18n keys, privacy notes. The owner approves it (`Status: approved`).
2. **Tests first.** One or more failing tests per acceptance criterion, named after it:
   `it('AC-2: shows the transcript when the job finishes', …)`.
   The PR that adds the tests sets `Status: building`.
3. **Code** until green, then tidy up. Set `Status: done` when the PR is ready to merge.
4. **PR** links the spec. CI must pass. `pnpm check:acs` checks that every AC in a `building` or `done` spec has at least one test.
5. Update `roadmap.md` (and `decisions.md` if a decision was made) in the same PR.

Planning and specs are done with the strongest model (Opus). Implementing an approved spec is handed to a
cheaper model (Sonnet) with the spec as the brief, then reviewed.

## Testing

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Pure logic, services with fakes, React components (Testing Library + jsdom), i18n completeness (every key in both `hu` and `en`) |
| Integration | Vitest + Testcontainers | API routes through `fastify.inject()` against a real Postgres 19 container. One container per test run, tables truncated between tests |
| End-to-end | Playwright | The production Docker image + Postgres via compose. Chromium with a fake microphone fed from WAV fixtures (Hungarian and English). Accessibility checks with axe on key pages |
| Nightly | Vitest + Playwright | Real transcription model on a few public sample clips, plus the eval report |

- Transcription and AI use fakes in normal tests (`NIGHTJAR_TRANSCRIBER=fake` returns fixture text), so tests are fast
  and don't need models.
- Coverage gates in CI: 90% lines for `apps/server` and `packages/shared`, 80% for `apps/web`. We don't chase 100%.

### Every plan has a test plan

- Every spec has a test plan table: each AC mapped to unit / UI / API / e2e tests. Nothing is "check manually".
- Every milestone lists its test deliverables in `roadmap.md`.
- UI is tested three ways: component tests (behaviour), Playwright e2e (real flows on mobile + desktop viewports,
  both languages), Playwright screenshot comparisons for key screens (visual regressions).

### Self-check loop (so Claude can verify and fix without the owner testing by hand)

```
 write test ─► run ─► read result ─► fix ─► run again ─► all green ─► PR ─► CI runs it all again
                         ▲
        clear text output, Playwright traces + screenshots on failure, server logs
```

| Need | How |
|---|---|
| One command for everything | `pnpm verify` = format check + lint + typecheck + unit (with coverage) + API + AC check + e2e. Runs every step, prints a PASS/FAIL summary, non-zero exit if any failed |
| Fast inner loop | `pnpm test` (unit, watch off), `pnpm test:api`, `pnpm test:e2e --grep AC-3` |
| See what the UI looks like | Playwright saves screenshots, videos and traces on failure into `test-results/` and an HTML report into `playwright-report/`. Both are gitignored, readable by Claude. Coverage HTML is in `coverage/` of each workspace |
| Try the running app | `pnpm dev` or the compose stack, plus the Playwright MCP browser for exploring a flow |
| Deterministic runs | Fake transcriber + fake AI, seeded test data, fixed clock and time zone in tests, WAV fixtures for the fake mic |
| Trust the gate | CI runs exactly the same `pnpm verify` inside the same Docker setup |

### Test layout and conventions

| Layer | Where | Run with |
|---|---|---|
| Unit | `src/**/*.test.ts(x)` next to the code, in `packages/shared`, `apps/server`, `apps/web` (jsdom + Testing Library) | `pnpm test` (per-workspace coverage gate: 90% / 90% / 80% lines) |
| API | `apps/server/test/*.test.ts`, Testcontainers starts `postgres:19` (needs Docker and the `docker` CLI on the PATH, some tests stop and start the container) | `pnpm test:api` |
| E2E | `e2e/*.spec.ts`, config in `playwright.config.ts`. Playwright starts the server (with its own Postgres container from Testcontainers) and the built web app via `vite preview`, on free ports picked per run, so two runs in different worktrees do not clash. Projects: `chromium` and `webkit-mobile` (iPhone 15). Will target the Docker image once it exists | `pnpm test:e2e` |

- **Fake mic:** each language has its own spec (`e2e/fake-mic.hu.spec.ts`, `e2e/fake-mic.en.spec.ts`) because Chromium
  launch args are per worker. They use `fakeMic('<clip>.wav')` from `e2e/support/fake-mic.ts` and only run in
  Chromium. Fixtures and their CC-BY-4.0 attribution are in `e2e/fixtures/`. Never use private recordings there.
- **Linking tests to a spec:** the spec file is `docs/specs/NNN-name.md`. The test file has a top-level
  `describe('NNN-name: short title', ...)`, and inside it `it('AC-2: ...')` (or `test(...)`).
  `pnpm check:acs` fails if a spec has an `**AC-n**` with no matching test in a file linked to that spec.
  `_template.md` is skipped, and so is any spec that is not `building` or `done` (status flow: `draft` → `approved` →
  `building` → `done`), so CI stays green until the spec's PR adds its tests.

Definition of done for any task: `pnpm verify` green locally, AC traceability check green, docs updated.

## Dev setup

- `docker compose -f docker/compose.dev.yaml up -d` starts Postgres.
- `pnpm dev` runs the server (`node --watch`) and Vite (hot reload) on your machine.
- Integration tests start their own Postgres through Testcontainers. E2E runs against the real image in Docker (for now: the dev server + built web app, until the image exists).
- Production runs in Docker only.

Node stays on the host for dev because file watching through bind mounts on Windows is slow. Everything that
ships or gets tested end-to-end runs in Docker.

## Observability

| What | How |
|---|---|
| Logs | pino, JSON to stdout, redaction on (no journal text, transcripts or file names) |
| Health | `/healthz` (up), `/readyz` (database reachable, migrations done) |
| Metrics | Prometheus `/metrics` via `prom-client` 15.1 (Apache-2.0): request latency and Node process metrics now; job duration, transcription speed (real-time factor) and queue depth arrive with the jobs (spec 003) |

`/metrics` is served on its own internal port (`NIGHTJAR_METRICS_PORT`, default 9464), not on the app port, and
`docker/compose.yaml` does not publish it. To scrape it, run Prometheus on the same compose network and add:

```yaml
scrape_configs:
  - job_name: nightjar
    static_configs:
      - targets: ['nightjar:9464']
```

Only publish the port (`ports: ['9464:9464']`) if Prometheus runs elsewhere, and keep it off the internet.

Log lines carry `level`, `time`, `msg` and, inside a request, `reqId`. Request lines hold only method, route
template, status and duration. Tests check log output with `apps/server/test/support/log-capture.ts` (capture logs,
assert a marker is absent).

### Configuration

Environment variables, validated with Zod at startup. A bad value stops the server with a message that names the
variable and never prints its value.

| Variable | Default | What |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `PORT` | `3000` | App port |
| `NIGHTJAR_METRICS_PORT` | `9464` | Internal metrics port |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` or `trace` |
| `NIGHTJAR_WEB_DIR` | unset | Built web app to serve (the image sets it) |
| `NIGHTJAR_TRUST_PROXY` | `0` | Number of reverse proxies in front of the server (`1` behind one). 0 ignores `X-Forwarded-*`. With 1 the client IP (login rate limit) and https (Secure cookie) come from what that proxy added; a client-set leftmost `X-Forwarded-For` is never trusted. The proxy must keep the original `Host` header |

Code layout: `apps/server/src/web.ts` (HTTP) and `worker.ts` (background jobs) are separate entry points that one
process starts together (`start.ts`). SQL migrations live in `apps/server/migrations` (made with
`pnpm --filter @nightjar/server db:generate`) and run in one transaction on start. `/api/v1` answers 503 until
they are done.

No extra services. Tests cover redaction, both health endpoints and the metrics output.

## Docker image

- Multi-stage build (`docker/Dockerfile`): install and build web → separate `pnpm install --prod` for the server
  (only runtime deps) → runtime stage on `node:26-trixie-slim` + ffmpeg. The server's `.ts` files are copied in as they are.
- Not `pnpm deploy`: it copies workspace packages into `node_modules`, and Node refuses to strip types there.
  A normal prod install keeps `@nightjar/shared` as a symlink, so type stripping works.
- Fastify serves the built web app when `NIGHTJAR_WEB_DIR` is set (the image sets it).
- Runs as a non-root user, only `/data` writable, `HEALTHCHECK` on `/healthz`, OCI labels.
- No models inside the image, they download to `/data/models` on first start.
- Built for `linux/amd64` and `linux/arm64` (Raspberry Pi 5, ARM NAS boxes). Built with buildx + QEMU in one job.
- `docker/compose.yaml` for users: `nightjar` + `db` (Postgres 19), one `.env` file (`POSTGRES_PASSWORD`).
  The app runs its migrations on start and reports ready when they are done. It has no tables yet.

## CI/CD (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| `ci.yml` | every PR and push to `main` | install (cached) → `pnpm verify` (needs Docker for Testcontainers, Playwright browsers cached) → build image (amd64 on PRs). On `main`: build amd64 + arm64 and push `edge`. Reports upload on failure |
| `release.yml` | push to `main` | release-please keeps a release PR up to date (version + changelog from conventional commits). When that PR is merged: build and push `X.Y.Z`, `X.Y`, `latest` with SBOM + provenance |
| `codeql.yml` | PRs, `main`, weekly | CodeQL for JavaScript/TypeScript |
| `nightly.yml` | nightly | real-model transcription tests + eval report. Not written yet, there are no real-model tests |

- PRs opened by release-please use the default token, so they do not trigger `ci.yml` by themselves. Close and reopen
  the release PR (or switch to a PAT) if the checks do not show up.
- The repo setting "Allow GitHub Actions to create and approve pull requests" must be on for release-please (it is on now).
- PR titles are checked against the conventional commit format (`pr-title` job in `ci.yml`), since squash merge uses the title.
- E2E still runs against `vite preview`. Switching it to the built image is a follow-up.

- Images go to **Docker Hub** only: `porsk/nightjar`. Secrets needed: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
- Dependabot for npm, Docker and Actions, weekly, grouped. CodeQL runs from `codeql.yml` (do not also enable default setup).
- Versioning: SemVer, `0.x` until 1.0. Database migrations only move forward and run on startup.

## Git workflow

- `main` is always releasable and protected. Short-lived branches, PRs, squash merge.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), checked in CI. They feed the changelog.
- DCO sign-off on commits (`git commit -s`), checked by the DCO GitHub app.

## M0 spikes (small throwaway checks before we commit to details)

1. **Transcription eval**: 20 or so own clips (Hungarian and English, quiet and noisy, short and long) with
   hand-written reference text. Script measures word error rate and speed for Parakeet v3 and Whisper turbo
   (incl. a Hungarian fine-tune). Reports results to the owner, who picks the default model.
2. **sherpa-onnx in Docker**: done (2026-11-26). `sherpa-onnx-node` 2.0.3 on `node:26-trixie-slim`, Whisper tiny.en int8
   (model downloaded at run time, 3 test clips).

   | | amd64 (native) | arm64 (QEMU on an amd64 PC) |
   |---|---|---|
   | Native addon loads, transcribes correctly | yes | yes |
   | Module load | 15 ms | 137 ms |
   | Real-time factor (tiny.en, 2 threads) | 0.04 to 0.05 | 4.0 to 4.7 (emulated, not meaningful) |

   Gotchas: no build tools needed (prebuilt per-platform packages, 33 MB on amd64). No `LD_LIBRARY_PATH` needed. The
   arm64 RTF only shows that it runs; real numbers need an actual ARM box (Pi 5). Image size with ffmpeg and the app:
   see the Docker image note below.
   Image size (Docker Desktop, uncompressed): 1.02 GB for the app image. Debian's ffmpeg pulls in many libraries
   (about 450 MB in `/usr/lib`); a smaller ffmpeg is a possible later optimisation.
3. **TypeScript**: done. TS 7 is blocked by typescript-eslint, so we use TS 6.0 (D-14). Revisit when typescript-eslint supports 7.
4. **Node type stripping**: done. The server runs from `.ts` files in dev and in the image (amd64 and arm64), including
   the shared package, as long as workspace packages stay symlinked (no `pnpm deploy`).
5. **iPhone recording**: PWA recording on a real iPhone, what happens when the screen locks.
