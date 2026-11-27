# Roadmap

**Now:** M1 round 1 merged (007, 001, 006, 002). Paused on usage limit: the smoke test + side-by-side review + layout checks task (branch `test/visual-review`, worktree under .claude/worktrees) was stopped mid-way; restart or resume it. 004 timeline is built (PR open), 003 runs in parallel.
**Next:** finish that task, owner reviews design/review/m1-round1.html, owner OK to release 0.1.0 (PR #29) after the smoke test passes, then 003 ∥ 004, then 005 ∥ 008 (D-35).

Legend: `[ ]` todo, `[~]` in progress, `[x]` done. Each milestone ends with something usable.

## M0 Foundations
- [x] Name (Nightjar), license (AGPL-3.0), GitHub owner (`porsk`), Node 26 + pnpm 12 installed
- [x] Plan drafted (`plan-summary.md` + detailed docs)
- [x] High-level plan approved by owner
- [ ] Spikes, results go to the owner: transcription eval on the owner's own clips, sherpa-onnx in Docker (amd64 + arm64),
      Node type stripping (iPhone PWA recording moved to M4, D-28)
- [x] Repo setup: git, LICENSE, README, CONTRIBUTING, pnpm workspace, lint/format
- [x] Test harness before any feature: Vitest, Testcontainers, Playwright (fake-mic WAV fixtures, screenshots,
      traces, axe), `pnpm verify`, AC traceability check, each proven with a sample test
- [x] Docker image + compose files
- [x] CI: lint, typecheck, tests, e2e, publish `edge` to Docker Hub (`porsk/nightjar`)
- [ ] Follow-up: run e2e against the Docker image instead of `vite preview`; nightly workflow once real-model tests exist
- [x] Design direction + M1 mockups approved
- [x] M1 specs approved

Done when: `docker compose up` shows a bilingual hello page, `edge` is on Docker Hub, the spikes are reported and M1 specs are approved.
Tests: a sample test per layer (unit, API, e2e with fake mic, screenshot, axe) passes in `pnpm verify` and in CI.

### M0 work packages

Task status lives in GitHub issues/milestones (`gh` CLI at `"/c/Program Files/GitHub CLI/gh.exe"`). This table is the summary.

| WP | Issue | What | Depends on | Needs from owner | Status |
|---|---|---|---|---|---|
| 1 | #1 | Repo skeleton + TS / type stripping spikes | - | - | done (TS 6.0, D-14) |
| 2 | #2 | Test harness: Vitest, Testcontainers, Playwright, `pnpm verify`, AC check | WP1 | - | done |
| 3 | #3 | Docker image + compose, CI, sherpa-onnx in Docker (amd64 + arm64) | WP1 | - (secrets added) | done (PR #28) |
| 4 | #4 | Speech eval (public clips first) | - | ~20 own clips in `eval/clips/own/` | round 2 done; own clips + Soniox next |
| 5 | #5 | Design directions | - | - | done: Alkony + M1 mockups approved (D-27) |
| 6 | #6 | iPhone recording test page | WP3 | A friend with an iPhone | moved to M4 (D-28) |
| 7 | #7 | M1 specs with test plans (main session) | WP5 | Approve specs | done (D-30) |

Parallel start: WP1, WP4, WP5. Then WP2 + WP3. Then WP6, WP7.

## M1 Speak and keep
- [x] 001 Setup wizard + login
- [x] 002 Text entries (write, edit, delete, entry date)
- [ ] 003 Voice entries (record, upload an existing audio file, background transcription, live status, edit transcript)
- [x] 004 Timeline
- [ ] 005 Search (Hungarian + English aware)
- [x] 006 Settings (UI language, default entry language, time zone) + HU/EN UI
- [x] 007 Logs, health, metrics
- [ ] 008 Backup guide (docs only: `pg_dump` + `/data` volume)
- [x] CI upgrade test: previous release to new image on the same database (right after the first release, D-29)

Done when: the owner journals daily for a week on phone + desktop.
Tests: every AC has a unit, API or e2e test. E2E records a HU and an EN WAV through the fake mic and sees the transcript. `/readyz` and `/metrics` are tested.

## M2 Journaling
- [ ] Photos
- [ ] Mood
- [ ] Manual tags + filters
- [ ] Multiple journals + favourites
- [ ] Calendar + gentle stats
- [ ] Prompts (HU + EN library, daily prompt, custom prompts)
- [ ] Look-backs (on this day, 1 month / 1 year ago)

Done when: the owner can attach photos, tag and filter entries, switch journals and get a daily prompt.
Tests: API tests for tags, filters, journals and look-back dates (fixed clock and time zone). E2E for photo upload, calendar and prompt flow.

## M3 AI and MCP
- [ ] Claude or Ollama enrichment suggestions (summary, tags, people, places)
- [ ] MCP server with access tokens (read, then write)

Done when: an entry gets suggestions the owner can accept, and Claude can search and read the journal over MCP with a token.
Tests: fake AI provider in normal tests, real providers in nightly. API tests for token scopes (read vs write). MCP client test against the running server.

## M4 Offline capture, then 1.0
- [ ] iPhone recording check on a real device (D-28)
- [ ] Offline recording queue
- [ ] Hardening
- [ ] 1.0 release

Done when: a recording made with no connection uploads and transcribes once the phone is back online, and 1.0 is published.
Tests: e2e with the network switched off and on, queue survives a reload. Full `pnpm verify` and the nightly real-model run are green on the release build.

## Backlog (not planned)
S-2, S-3, S-10 to S-18 in `decisions.md`: export zip and backups, imports, share target and widgets, word-highlight playback,
ask your journal, monthly summaries, family accounts, passkeys, AI photo captions, Capacitor, GHCR.
