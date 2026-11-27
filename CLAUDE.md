# Nightjar

Self-hosted, open source voice + text journal. Hungarian and English (recordings and UI). AGPL-3.0.

## Docs (keep them current, in the same change that makes them stale)

| File | What |
|---|---|
| `docs/plan-summary.md` | The plan on one page. This is what the owner reads |
| `docs/roadmap.md` | Milestones and checkboxes |
| `docs/decisions.md` | Open, decided and proposed decisions, feature scope |
| `docs/product.md` | Features, flows, non-goals (reference) |
| `docs/architecture.md` | How the system fits together (reference) |
| `docs/engineering.md` | Versions, code style, testing, Docker, CI (reference) |
| `docs/design.md` | Design direction and screens |
| `docs/specs/` | One spec per feature, written before the code |
| `docs/research/` | Background research with sources |

## How we work

- **Plan first.** No building until the plan / spec is approved. If the plan needs to change, ask the owner first.
- **Orchestrator.** The main session plans, writes requirements/specs, reviews and decides what to ask the owner.
  Subagents (Sonnet, parallel where possible) do the reading, coding, wiring and testing.
- **Don't assume, verify. Don't invent features.** Anything the owner did not ask for is listed as a suggestion
  in `docs/decisions.md` until approved.
- **Smallest change that works.** No extra services, switches, backup plans or "might need it later".
- **Defaults:** secure, current packages, containerized, observable, measurable, tested.
- **Resume from files.** Current status and next step are at the top of `docs/roadmap.md`; open items in `docs/decisions.md`.
- **Spec, then tests, then code.** Specs have acceptance criteria `AC-1`, `AC-2`… Each gets a test named after it:
  `it('AC-2: shows the transcript when the job finishes', …)`.
- **Every plan and spec has a test plan.** Every AC is covered by automated tests (unit, UI, API, e2e).
  The owner won't test by hand, so verify your own work: run `pnpm verify`, read failures (screenshots, traces,
  logs), fix, repeat until green. Done = `pnpm verify` green + docs updated.
- **Tests:** Vitest (unit), Vitest + Testcontainers (API on real Postgres), Playwright (real image, fake mic from WAV files).
  Transcription and AI are faked except in nightly tests. Coverage: 90% server/shared, 80% web.
- **Models:** plan and write specs with Opus. Hand approved specs to Sonnet subagents to implement, then review.
- **Talking to the owner:** short, tables and diagrams, decisions as a couple of options with a recommendation.

## Rules

- Latest stable versions (Node 26 LTS, pnpm 12). Check the registry before adding a dependency. Deps must be AGPL-compatible.
- TypeScript strict everywhere. Python only for one-off tooling, never at runtime.
- Code explains itself. Comments only for tricky logic, short doc comments on exports. No ticket numbers,
  decision references or history in code.
- Plain, casual English in docs, commits and comments. No em dashes.
- No hard-coded user-facing text: everything through i18n, every key in both `hu` and `en`.
- Privacy: never log journal text, transcripts or file names. AI is opt-in and the UI shows when an entry was sent out.
- Ships as one Docker image on Docker Hub (`porsk/nightjar`). Conventional commits, DCO sign-off.
- Open a PR only when the branch is verified locally (`pnpm verify` green) and review fixes are in; CI runs on PRs and main only.
- Background waits in scripts or agents always have a timeout; never start duplicate waits.
- Commits are authored by `porsk` only: no `Co-Authored-By: Claude` trailer, no "Generated with Claude Code" line in PRs.

## Commands

```
pnpm install        # install everything
pnpm dev            # server (node --watch, :3000) + web (Vite, :5173)
pnpm build          # build the web app
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit in every workspace
pnpm format         # Prettier, write
pnpm format:check   # Prettier, check only
pnpm test           # unit tests with coverage (all workspaces)
pnpm test:api       # API tests, Vitest + Testcontainers (needs Docker)
pnpm test:e2e       # Playwright (reports in playwright-report/, traces + screenshots in test-results/)
pnpm check:acs      # every AC in docs/specs has a test
pnpm verify         # everything above, run before calling anything done
```
