# Roadmap

**Now:** M0 running. WP1 repo skeleton, WP4 speech eval, WP5 round 2 (owner likes Alkony most, Erdő too; Tinta dropped; 3 new options coming), GitHub milestones + issues being created.
**Next:** run M0 work packages (see below). Open items in `decisions.md`.

Legend: `[ ]` todo, `[~]` in progress, `[x]` done. Each milestone ends with something usable.

## M0 Foundations
- [x] Name (Nightjar), license (AGPL-3.0), GitHub owner (`porsk`), Node 26 + pnpm 12 installed
- [x] Plan drafted (`plan-summary.md` + detailed docs)
- [x] High-level plan approved by owner
- [ ] Spikes, results go to the owner: transcription eval on the owner's own clips, sherpa-onnx in Docker (amd64 + arm64),
      TypeScript 7 with lint/test tools, Node type stripping, iPhone PWA recording
- [ ] Repo setup: git, LICENSE, README, CONTRIBUTING, pnpm workspace, lint/format
- [ ] Test harness before any feature: Vitest, Testcontainers, Playwright (fake-mic WAV fixtures, screenshots,
      traces, axe), `pnpm verify`, AC traceability check, each proven with a sample test
- [ ] Docker image + compose files
- [ ] CI: lint, typecheck, tests, e2e, publish `edge` to Docker Hub (`porsk/nightjar`)
- [ ] Design direction + M1 mockups approved
- [ ] M1 specs approved

Done when: `docker compose up` shows a bilingual hello page, `edge` is on Docker Hub, the spikes are reported and M1 specs are approved.
Tests: a sample test per layer (unit, API, e2e with fake mic, screenshot, axe) passes in `pnpm verify` and in CI.

### M0 work packages

| WP | What | Who | Depends on | Needs from owner |
|---|---|---|---|---|
| 1 | Repo skeleton: git, workspace, TS strict, lint/format, LICENSE/README. TS 7 + Node type stripping spikes | Sonnet agent | - | - |
| 2 | Test harness: Vitest, Testcontainers, Playwright (fake mic, screenshots, traces, axe), `pnpm verify`, AC check | Sonnet agent | WP1 | - |
| 3 | Docker image + compose, CI workflow, sherpa-onnx in Docker (amd64 + arm64) spike | Sonnet agent | WP1 | GitHub remote + `DOCKERHUB_TOKEN` (only for the publish step) |
| 4 | Speech eval: script + public HU/EN clips, local free engines, report (accuracy, speed, RAM, cost) | Sonnet agent | - | ~20 own clips later (round 2) |
| 5 | Design: 2 or 3 visual directions as HTML mockups | Sonnet agent | - | Pick a direction |
| 6 | iPhone recording spike: tiny test page | Sonnet agent | WP3 | Open it on your iPhone |
| 7 | M1 specs with test plans | Main session (Opus) | WP5 | Approve specs |

Parallel start: WP1, WP4, WP5. Then WP2 + WP3. Then WP6, WP7.

## M1 Speak and keep
- [ ] 001 Setup wizard + login
- [ ] 002 Text entries (write, edit, delete, entry date)
- [ ] 003 Voice entries (record, upload an existing audio file, background transcription, live status, edit transcript)
- [ ] 004 Timeline
- [ ] 005 Search (Hungarian + English aware)
- [ ] 006 Settings (UI language, default entry language, time zone) + HU/EN UI
- [ ] 007 Logs, health, metrics
- [ ] 008 Backup guide (docs only: `pg_dump` + `/data` volume)

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
- [ ] Offline recording queue
- [ ] Hardening
- [ ] 1.0 release

Done when: a recording made with no connection uploads and transcribes once the phone is back online, and 1.0 is published.
Tests: e2e with the network switched off and on, queue survives a reload. Full `pnpm verify` and the nightly real-model run are green on the release build.

## Backlog (not planned)
S-2, S-3, S-10 to S-18 in `decisions.md`: export zip and backups, imports, share target and widgets, word-highlight playback,
ask your journal, monthly summaries, family accounts, passkeys, AI photo captions, Capacitor, GHCR.
