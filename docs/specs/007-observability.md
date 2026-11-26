# 007 Logs, health, metrics

Status: draft
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
  queue depth, plus Node's default process metrics.

Out (not now): tracing, log shipping, dashboards, alerts, an admin UI for logs.

## Acceptance criteria

- **AC-1** Given the server runs, then every log line on stdout is one JSON object with `level`, `time`, `msg`, and `reqId` for lines that belong to a request; `LOG_LEVEL=warn` hides `info` lines.
- **AC-2** Given a test that creates an entry with a marker string in the body, uploads a recording whose file name contains a marker, gets a fake transcript containing a marker, edits that transcript, searches for the marker, sends a body that fails validation with a marker in it, makes a transcription job fail, and logs in with a marker email and password, then none of the markers appear anywhere in the captured log output.
- **AC-3** Given any request, then its log line has method, route template (`/api/v1/entries/:id`, not the real id), status code and duration, and has no query string, no request or response body, and no `cookie` or `authorization` header.
- **AC-4** Given the process is running, when `/healthz` is called, then it answers 200 `{ "status": "ok" }`, without auth, even while the database is down.
- **AC-5** Given the database is reachable and migrations are done, then `/readyz` answers 200; given the database is down or migrations are still running, then it answers 503 with `status` `db_down` or `starting`; when the database comes back, it answers 200 again without a restart.
- **AC-6** Given an empty database, when the server starts, then it applies all migrations before serving `/api/v1` (API calls before that get 503); a second start applies nothing; a failing migration leaves no partial schema change, logs the error and exits with a non-zero code.
- **AC-7** Given a few API requests and one finished fake transcription job, then `/metrics` returns Prometheus text with `http_request_duration_seconds` (labels `method`, `route`, `status_code`), `nightjar_job_duration_seconds` (`queue`, `outcome`), `nightjar_transcription_rtf` (`model`), `nightjar_queue_depth` (`queue`) and the default `process_*` / `nodejs_*` metrics, and their counts went up.
- **AC-8** Given requests to 50 different entry ids, then `/metrics` has one series for that route (template label), and no metric label holds a user id, email, entry id or any text.

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
| AC-7 | | | parse `/metrics`, check names, labels, counts | | fake transcriber reports a duration so RTF is known |
| AC-8 | | | 50 ids → 1 series; label values checked against a pattern | | |

Also covered: the Docker `HEALTHCHECK` keeps using `/healthz`.

## i18n
No new user-facing text.

## Privacy & data
- Logs: no journal text, transcripts, file names, search queries, emails, passwords or tokens (AC-2, AC-3).
- `/healthz`, `/readyz` and `/metrics` hold no user data and need no login. How to keep `/metrics` private: question 10.
- Nothing leaves the server; Prometheus scrapes it if the owner sets that up.

## Open questions
- Should `/metrics` need a token? See m1-summary, question 10.
