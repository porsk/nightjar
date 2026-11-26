# Nightjar: plan on one page

A self-hosted journal you can talk to. Hungarian + English, transcribed offline on your own server.

## What it does

| Area | Features | Milestone |
|---|---|---|
| Capture | Record in the browser/PWA, type, upload an audio file | M1 |
| Capture | Photos | M2 |
| Capture | Offline recording queue | M4 |
| Transcription | Offline, background, editable, HU / EN / auto | M1 |
| Find | Timeline, search that understands Hungarian word endings | M1 |
| Find | Mood, manual tags, filters, multiple journals, favourites, calendar | M2 |
| Reflect | Prompts, look-backs, gentle stats | M2 |
| AI (opt-in) | Claude or Ollama suggest summary, tags, people, places | M3 |
| MCP (opt-in) | Claude reads (then writes) your journal with an access token | M3 |

## How it fits together

```
  Phone / desktop (PWA)                Claude Desktop / Code
          │                                    │ MCP
          ▼                                    ▼
 ┌─────────────── nightjar container (one Node process) ───────────────┐
 │  Fastify: web app, REST API, live updates (SSE), MCP, /metrics      │
 │  Jobs:  ffmpeg ─► sherpa-onnx (speech to text) ─► AI (opt-in)       │
 └──────────┬───────────────────────────────────────────┬──────────────┘
            ▼                                           ▼
       Postgres 19                         /data: audio, photos, models
```

## Stack

| Part | Choice |
|---|---|
| Server | Node 26 (runs `.ts` directly), Fastify, Zod, Drizzle, pg-boss (jobs in Postgres), Better Auth |
| Web | React 19, Vite, React Router, TanStack Query, i18next, PWA. Follows system light/dark |
| Speech | Whisper large-v3-turbo (int8, sherpa-onnx), off by default; you turn it on in Settings and the model downloads then. Final pick after your own clips (D-20, D-23) |
| Search | Postgres full-text, Hungarian + English stemming |
| AI | Claude (official SDK) or Ollama, provider and key set in Settings (stored encrypted, M3), off by default |
| Observability | pino JSON logs, `/healthz`, `/readyz`, Prometheus `/metrics` |
| Tests | Vitest, Testcontainers, Playwright (fake mic plays real HU/EN audio) |
| Ship | One Docker image `porsk/nightjar`, amd64 + arm64, Docker Hub, GitHub Actions |
| Dev | Postgres in Docker, Node + Vite on your machine. Prod and e2e in Docker |

## Milestones

| | Milestone | Done when |
|---|---|---|
| M0 | Foundations | Spikes reported, test harness, Docker image, CI publishes `edge`, design + M1 specs approved |
| M1 | Speak and keep | Setup, login, text + voice entries, upload audio, timeline, search, settings, HU/EN, logs/health/metrics |
| M2 | Journaling | Photos, mood, tags + filters, journals + favourites, calendar + stats, prompts, look-backs |
| M3 | AI and MCP | Claude/Ollama suggestions, MCP server with tokens |
| M4 | Offline capture, then 1.0 | Offline recording queue, hardening, 1.0 release |

```
M0 ─► M1 ─► M2 ─► M3 ─► M4 (1.0)
```

## M0 spikes (results go to you)

| Question | Check |
|---|---|
| Hungarian accuracy on your voice | Record ~20 clips, measure both models |
| Speech engine in Docker on ARM | Build and run the image on both architectures |
| iPhone stops recording when the screen locks | Test on a real iPhone |
| Node runs `.ts` directly | Try it in dev and in the image |

## How we build

Spec + test plan (you approve) ─► failing tests ─► code ─► `pnpm verify` green ─► CI green ─► merge.

| Rule | Meaning |
|---|---|
| Every AC is tested automatically | Unit, UI/component, API, e2e. Never "check by hand" |
| Claude checks its own work | One command runs everything. Failures leave screenshots, traces and logs |
| Test harness first | Built in M0, before any feature |
| Simple first | Nothing added until needed. Opus plans, Sonnet implements |

## Need from you

Approve the plan, then M0 starts.

Details: [product](product.md) · [architecture](architecture.md) · [engineering](engineering.md) · [design](design.md) · [roadmap](roadmap.md) · [decisions](decisions.md)
