# 007 Logs, health, metrics

Status: done
Milestone: M1

## Why
The owner wants the server observable and measurable (P-13) without extra services, and the logs must never leak
journal content.

## Scope
In:
- pino JSON logs to stdout with redaction, request logs, `LOG_LEVEL` (default `info`).
- `/healthz` (process is up) and `/readyz` (database reachable, migrations done).
- Database migrations run automatically on start; the server only reports ready when they are done.
- Prometheus `/metrics` (`prom-client`): request latency plus Node's default process metrics. Job duration,
  transcription speed (real-time factor) and queue depth come with the jobs in spec 003 (AC-30). Served on a separate internal port (`NIGHTJAR_METRICS_PORT`,
  default 9464), not on the app port, and not published in `docker/compose.yaml` (D-30 Q10). Scrape docs in
  `docs/engineering.md`, "Observability".

Out (not now): tracing, log shipping, dashboards, alerts, an admin UI for logs.

## Acceptance criteria

- **AC-1** Given the server runs, then every log line on stdout is one JSON object with `level`, `time`, `msg`, and `reqId` for lines that belong to a request; `LOG_LEVEL=warn` hides `info` lines.
- **AC-2** Given routes that exist only in the test (they take a marker string like `ZQX-PRIVATE-7781` in the body, query string, URL parameter, `cookie` and `authorization` headers, an upload file name, invalid JSON, a failing validation and a thrown error message), then none of the markers appear anywhere in the captured log output. The shared test helper `apps/server/test/support/log-capture.ts` (capture logs, assert marker absent) is reused by the log ACs in 001, 002, 003 and 005, which run the real flows.
- **AC-3** Given any request (tested on a test-only route with a parameter), then its log line has method, route template (`/api/v1/test-items/:id`, not the real id), status code and duration, and has no query string, no request or response body, and no `cookie` or `authorization` header.
- **AC-4** Given the process is running, when `/healthz` is called, then it answers 200 `{ "status": "ok" }`, without auth, even while the database is down.
- **AC-5** Given the database is reachable and migrations are done, then `/readyz` answers 200; given the database is down or migrations are still running, then it answers 503 with `status` `db_down` or `starting`; when the database comes back, it answers 200 again without a restart.
- **AC-6** Given an empty database, when the server starts, then it applies all migrations before serving `/api/v1` (API calls before that get 503); a second start applies nothing; a failing migration leaves no partial schema change, logs the error and exits with a non-zero code.
- AC-7 moved to spec 003 (AC-30), because jobs and the queue arrive there. The number stays unused here.
- **AC-8** Given requests to 50 different ids on a test-only route with a parameter, then `/metrics` has one series for that route (template label), and no metric label holds an id, username or any text.
- **AC-9** Given the app port (3000), when `/metrics` is requested there, then it answers 404; the metrics port serves only `/metrics`.
- **AC-10** Given the shipped files, then `docker/compose.yaml` publishes only port 3000, the Dockerfile exposes only 3000, and `docs/engineering.md` shows a Prometheus scrape config for the metrics port (compose network name + `NIGHTJAR_METRICS_PORT`).

## Test plan

Logs are captured by giving the app a pino destination stream in API tests (no stdout scraping).

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | logger config (level, JSON) | | lines parse as JSON, `reqId` present | | |
| AC-2 | one test, every marker path, assert no marker in captured logs | | | | marker `ZQX-PRIVATE-7781`; test-only routes; helper reused by 001, 002, 003, 005 |
| AC-3 | log line of a test-only route with query, body, cookie | | | | |
| AC-4 | | | 200 with DB container stopped | | |
| AC-5 | | | stop container → 503 `db_down`, start → 200 | | Testcontainers stop / start |
| AC-6 | | | empty DB start, second start, broken migration in a temp folder → exit code ≠ 0 | | migrations run in one transaction |
| AC-7 | | | | | moved to 003 (AC-30) |
| AC-8 | 50 ids → 1 series; label values checked against a pattern | | | | test-only route |
| AC-9 | | | `GET :3000/metrics` → 404; metrics port answers `/metrics` only | | two ports in the test server |
| AC-10 | parse `docker/compose.yaml`, Dockerfile `EXPOSE`, grep the doc for the port and env var | | | | file checks only |

Also covered: the Docker `HEALTHCHECK` keeps using `/healthz`.

## i18n
No new user-facing text.

## Privacy & data
- Logs: no journal text, transcripts, file names, search queries, usernames, names, passwords or tokens (AC-2, AC-3).
- `/healthz` and `/readyz` hold no user data and need no login. `/metrics` holds no user data but shows activity, so it is on its own internal port that is not published by default; whoever publishes it should keep it off the internet.
- Nothing leaves the server; Prometheus scrapes it if the owner sets that up.

## Open questions
None.
