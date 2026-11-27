<p align="center">
  <img src="https://raw.githubusercontent.com/porsk/nightjar/main/design/logo/nightjar.svg" alt="Nightjar logo" width="96" height="96">
</p>

# Nightjar

*Verba volant, scripta manent.* Spoken words fly away, written words remain.

**A self-hosted voice journal.** Speak or type, and your own server turns it into searchable text, fully offline.

[![CI](https://github.com/porsk/nightjar/actions/workflows/ci.yml/badge.svg)](https://github.com/porsk/nightjar/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/porsk/nightjar)](https://github.com/porsk/nightjar/releases)
[![Docker pulls](https://img.shields.io/docker/pulls/porsk/nightjar)](https://hub.docker.com/r/porsk/nightjar)
[![Docker image size](https://img.shields.io/docker/image-size/porsk/nightjar/edge)](https://hub.docker.com/r/porsk/nightjar)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

![Nightjar home screen, dark theme](https://raw.githubusercontent.com/porsk/nightjar/main/design/alkony/screenshots/readme-home-dark-1280.png)

*Design preview.*

- **Speak or type.** One tap to record in the browser, or just write. Hungarian and English.
- **Transcribed offline on your server.** Whisper speech to text runs in your own container. No cloud needed.
- **Your data stays yours.** Self-hosted, private by design, no telemetry. AI is opt-in and off by default.

## Why Nightjar?

The nightjar is a bird that wakes up at dusk and sings through the night, the hour when many of us finally think back
over the day. A jar is where you keep good things safe, like your own words. *Verba volant, scripta manent*: what you
say flies away, what you write stays. Nightjar keeps it, on your own server.

> **Status: early development.** Nothing is usable yet. The app only shows a hello page so far. The screenshot above
> is the approved design, not the running app. Follow the [roadmap](docs/roadmap.md).

## Features

A private audio diary for your homelab: Docker, one Postgres, an installable web app (PWA) for phone and desktop.
Hungarian and English (recordings and UI) today, more languages possible later.

| Feature | Status |
|---|---|
| Record in the browser, type, or upload an audio file | planned (M1) |
| Offline transcription with Whisper, editable, Hungarian and English | planned (M1) |
| Timeline and search that understands Hungarian word endings | planned (M1) |
| Setup, login, settings, light and dark theme | planned (M1) |
| Logs, health checks, Prometheus metrics | ✅ server side |
| Photos, mood, tags and filters | planned (M2) |
| Multiple journals, favourites, calendar and gentle stats | planned (M2) |
| Prompts and look-backs ("on this day") | planned (M2) |
| Optional AI suggestions: summary, tags, people, places (Claude or a local Ollama model) | planned (M3) |
| MCP server so your AI assistant can read your journal when you allow it | planned (M3) |
| Offline recording queue, then 1.0 | planned (M4) |

## Quick start

You need Docker. Releases are published to Docker Hub as `porsk/nightjar` (`edge` is the latest main build).

```
cd docker
cp .env.example .env     # set POSTGRES_PASSWORD
docker compose up -d
```

Until the first release exists there is no `latest` tag. Until then, change the image in `docker/compose.yaml` to `porsk/nightjar:edge`.

Then open http://localhost:3000. Putting it on a domain behind Traefik and Cloudflare? See the [self-hosting guide](docs/self-hosting.md). Data lives in the `nightjar-data` and `nightjar-db` volumes. Back them up: see the [backup guide](docs/backup.md).

## Docs

[Plan on one page](https://github.com/porsk/nightjar/blob/main/docs/plan-summary.md) ·
[Roadmap](https://github.com/porsk/nightjar/blob/main/docs/roadmap.md) ·
[Product](https://github.com/porsk/nightjar/blob/main/docs/product.md) ·
[Architecture](https://github.com/porsk/nightjar/blob/main/docs/architecture.md) ·
[Design](https://github.com/porsk/nightjar/blob/main/docs/design.md) ·
[Decisions](https://github.com/porsk/nightjar/blob/main/docs/decisions.md)

## Development

```
pnpm install
pnpm dev      # server on :3000, web app on :5173
```

See [CONTRIBUTING.md](https://github.com/porsk/nightjar/blob/main/CONTRIBUTING.md). To report a security problem, see
[SECURITY.md](https://github.com/porsk/nightjar/blob/main/SECURITY.md).

## License

[AGPL-3.0](https://github.com/porsk/nightjar/blob/main/LICENSE)
