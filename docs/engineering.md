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
| Server | Fastify 5.12, Zod 4.6, Drizzle ORM 0.45 + drizzle-kit 0.31, pg-boss 12.40, Better Auth 1.7, pino 10, prom-client 15.1 |
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
   plan, i18n keys, privacy notes. The owner approves it.
2. **Tests first.** One or more failing tests per acceptance criterion, named after it:
   `it('AC-2: shows the transcript when the job finishes', …)`.
3. **Code** until green, then tidy up.
4. **PR** links the spec. CI must pass. A small script checks that every AC in the spec has at least one test.
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
| One command for everything | `pnpm verify` = lint + typecheck + unit + integration + e2e, non-zero exit on any failure |
| Fast inner loop | `pnpm test` (unit, watch off), `pnpm test:api`, `pnpm test:e2e --grep AC-3` |
| See what the UI looks like | Playwright saves screenshots, videos and traces on failure into `test-results/`, readable by Claude |
| Try the running app | `pnpm dev` or the compose stack, plus the Playwright MCP browser for exploring a flow |
| Deterministic runs | Fake transcriber + fake AI, seeded test data, fixed clock and time zone in tests, WAV fixtures for the fake mic |
| Trust the gate | CI runs exactly the same `pnpm verify` inside the same Docker setup |

Definition of done for any task: `pnpm verify` green locally, AC traceability check green, docs updated.

## Dev setup

- `docker compose -f docker/compose.dev.yaml up -d` starts Postgres.
- `pnpm dev` runs the server (`node --watch`) and Vite (hot reload) on your machine.
- Integration tests start their own Postgres through Testcontainers. E2E runs against the real image in Docker.
- Production runs in Docker only.

Node stays on the host for dev because file watching through bind mounts on Windows is slow. Everything that
ships or gets tested end-to-end runs in Docker.

## Observability

| What | How |
|---|---|
| Logs | pino, JSON to stdout, redaction on (no journal text, transcripts or file names) |
| Health | `/healthz` (up), `/readyz` (database reachable, migrations done) |
| Metrics | Prometheus `/metrics` via `prom-client` 15.1 (Apache-2.0): request latency, job duration, transcription speed (real-time factor), queue depth |

No extra services. Tests cover redaction, both health endpoints and the metrics output.

## Docker image

- Multi-stage build: install → build web → `pnpm deploy --prod` (only runtime deps) → runtime stage on
  `node:26` slim + ffmpeg.
- Runs as a non-root user, only `/data` writable, `HEALTHCHECK` on `/healthz`, OCI labels.
- No models inside the image, they download to `/data/models` on first start.
- Built for `linux/amd64` and `linux/arm64` (Raspberry Pi 5, ARM NAS boxes). Built with buildx + QEMU in one job.
- `docker/compose.yaml` for users: `nightjar` + `db`, one `.env` file. 

## CI/CD (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| `ci.yml` | every PR and push to `main` | install (cached) → lint, typecheck, unit + integration tests → build image → e2e against the image. On `main`: push `edge` tag |
| `release.yml` | release-please PR merged | release-please bumps the version and writes the changelog from conventional commits → build and push `X.Y.Z`, `X.Y`, `latest` with SBOM + provenance → GitHub release |
| `nightly.yml` | nightly | real-model transcription tests + eval report |

- Images go to **Docker Hub** only: `porsk/nightjar`. Secrets needed: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.
- Dependabot for npm, Docker and Actions, weekly, grouped. CodeQL default setup (one click in repo settings).
- Versioning: SemVer, `0.x` until 1.0. Database migrations only move forward and run on startup.

## Git workflow

- `main` is always releasable and protected. Short-lived branches, PRs, squash merge.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), checked in CI. They feed the changelog.
- DCO sign-off on commits (`git commit -s`), checked by the DCO GitHub app.

## M0 spikes (small throwaway checks before we commit to details)

1. **Transcription eval**: 20 or so own clips (Hungarian and English, quiet and noisy, short and long) with
   hand-written reference text. Script measures word error rate and speed for Parakeet v3 and Whisper turbo
   (incl. a Hungarian fine-tune). Reports results to the owner, who picks the default model.
2. **sherpa-onnx in Docker**: native addon loads on Node 26, slim image, amd64 and arm64.
3. **TypeScript**: done. TS 7 is blocked by typescript-eslint, so we use TS 6.0 (D-14). Revisit when typescript-eslint supports 7.
4. **Node type stripping**: server runs from `.ts` files in dev and in the image, including the shared package.
5. **iPhone recording**: PWA recording on a real iPhone, what happens when the screen locks.
