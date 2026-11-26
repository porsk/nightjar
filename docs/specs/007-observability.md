# 007 Logs, health, metrics

Status: approved
Milestone: M1

## Why
The owner wants the server observable and measurable (P-13) without extra services, and the logs must never leak
journal content.

## Scope
In:
- pino JSON logs to stdout with redaction, request logs, `LOG_LEVEL` (default `info`).
- `/healthz` (process is up) and `/readyz` (database reachable, migrations done).
- Database migrations run automatically on start; the server only reports ready when they are done.
- Prometheus `/metrics` (`prom-client`): request latency, job duration, transcription speed (real-time factor),
  queue depth, plus Node's default process metrics. Served on a separate internal port (`NIGHTJAR_METRICS_PORT`,
  default 9464), not on the app port, and not published in `docker/compose.yaml` (D-30 Q10). Scrape docs in
  `docs/engineering.md`, "Observability".

Out (not now): tracing, log shipping, dashboards, alerts, an admin UI for logs.

## Acceptance criteria

- **AC-1** Given the server runs, then every log line on stdout is one JSON object with `level`, `time`, `msg`, and `reqId` for lines that belong to a request; `LOG_LEVEL=warn` hides `info` lines.
- **AC-2** Given a test that creates an entry with a marker string in the body, uploads a recording whose file name contains a marker, gets a fake transcript containing a marker, edits that transcript, searches for the marker, sends a body that fails validation with a marker in it, makes a transcription job fail, and logs in with a marker email and password, then none of the markers appear anywhere in the captured log output.
- **AC-3** Given any request, then its log line has method, route template (`/api/v1/entries/:id`, not the real id), status code and duration, and has no query string, no request or response body, and no `cookie` or `authorization` header.
- **AC-4** Given the process is running, when `/healthz` is called, then it answers 200 `{ "status": "ok" }`, without auth, even while the database is down.
- **AC-5** Given the database is reachable and migrations are done, then `/readyz` answers 200; given the database is down or migrations are still running, then it answers 503 with `status` `db_down` or `starting`; when the database comes back, it answers 200 again without a restart.
- **AC-6** Given an empty database, when the server starts, then it applies all migrations before serving `/api/v1` (API calls before that get 503); a second start applies nothing; a failing migration leaves no partial schema change, logs the error and exits with a non-zero code.
- **AC-7** Given a few API requests and one finished fake transcription job, then `/metrics` on the metrics port returns Prometheus text with `http_request_duration_seconds` (labels `method`, `route`, `status_code`), `nightjar_job_duration_seconds` (`queue`, `outcome`), `nightjar_transcription_rtf` (`model`), `nightjar_queue_depth` (`queue`) and the default `process_*` / `nodejs_*` metrics, and their counts went up.
- **AC-8** Given requests to 50 different entry ids, then `/metrics` has one series for that route (template label), and no metric label holds a user id, email, entry id or any text.
- **AC-9** Given the app port (3000), when `/metrics` is requested there, then it answers 404; the metrics port serves only `/metrics`.
- **AC-10** Given the shipped files, then `docker/compose.yaml` publishes only port 3000, the Dockerfile exposes only 3000, and `docs/engineering.md` shows a Prometheus scrape config for the metrics port (compose network name + `NIGHTJAR_METRICS_PORT`).

## Test plan

Logs are captured by giving the app a pino destination stream in API tests (no stdout scraping).

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | logger config (level, JSON) | | lines parse as JSON, `reqId` present | | |
| AC-2 | | | full marker flow, assert no marker in captured logs | | marker like `ZQX-PRIVATE-7781`; fake transcriber returns it; one test, every path |
| AC-3 | serializer drops query, body, cookie, auth | | `/api/v1/search?q=marker` log line | | |
| AC-4 | | | 200 with DB container stopped | | |
| AC-5 | | | stop container → 503 `db_down`, start → 200 | | Testcontainers stop / start |
| AC-6 | | | empty DB start, second start, broken migration in a temp folder → exit code ≠ 0 | | migrations run in one transaction |
| AC-7 | | | parse `/metrics` from the metrics port, check names, labels, counts | | fake transcriber reports a duration so RTF is known |
| AC-8 | | | 50 ids → 1 series; label values checked against a pattern | | |
| AC-9 | | | `GET :3000/metrics` → 404; metrics port answers `/metrics` only | | two ports in the test server |
| AC-10 | parse `docker/compose.yaml`, Dockerfile `EXPOSE`, grep the doc for the port and env var | | | | file checks only |

Also covered: the Docker `HEALTHCHECK` keeps using `/healthz`.

## i18n
No new user-facing text.

## Privacy & data
- Logs: no journal text, transcripts, file names, search queries, emails, passwords or tokens (AC-2, AC-3).
- `/healthz` and `/readyz` hold no user data and need no login. `/metrics` holds no user data but shows activity, so it is on its own internal port that is not published by default; whoever publishes it should keep it off the internet.
- Nothing leaves the server; Prometheus scrapes it if the owner sets that up.

## Open questions
None.
