# Nightjar

*Verba volant, scripta manent.* Spoken words fly away, written words remain.

A self-hosted, open source journal you can talk to. Speak or type in Hungarian or English, and your own server
turns recordings into searchable text, fully offline. Prompts, look-backs, mood, tags and photos. Optional AI
(Claude or a local model) to suggest summaries, tags, people and places, and an MCP server so your AI assistant can read your journal
when you allow it.

> Status: early development. The app only shows a hello page so far.

Plan: [docs/plan-summary.md](docs/plan-summary.md)

License: AGPL-3.0

## Install

You need Docker. Releases are published to Docker Hub as `porsk/nightjar` (`edge` is the latest main build).

```
cd docker
cp .env.example .env     # set POSTGRES_PASSWORD
docker compose up -d
```

Then open http://localhost:3000. Data lives in the `nightjar-data` and `nightjar-db` volumes.

## Development

```
pnpm install
pnpm dev      # server on :3000, web app on :5173
```

See [CONTRIBUTING.md](CONTRIBUTING.md).
