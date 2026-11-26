# 008 Backup guide

Status: draft
Milestone: M1

## Why
Journal data must not get lost. A short guide (D-11, docs only) tells the owner how to back up and restore the
database and the data volume, and what to do before upgrades.

## Scope
In: a new page `docs/backup.md`, linked from the README "Install" section, covering:

| Section | Content |
|---|---|
| What to back up | Postgres (`db` service, `nightjar-db` volume) and the `nightjar-data` volume (`media/` is needed, `models/` can be downloaded again) |
| Back up | `docker compose exec db pg_dump -Fc` to a file, plus a tar of `nightjar-data` through a throwaway container. A cron example |
| Restore | Fresh volumes, `pg_restore` into the empty database, untar `nightjar-data`, start the app |
| Before upgrading | Always back up before `docker compose pull && docker compose up -d`; migrations only move forward, so the backup is the way back |
| Postgres major upgrade | `docker/compose.yaml` pins the major (`postgres:19`), so pulling never upgrades it. Moving to a new major: back up with `pg_dump`, switch the image tag, start with a new empty volume, restore |
| Check your backup | Restore into a test stack now and then |

Out (not now): export zip (backlog S-2), built-in or scheduled backups, off-site copies, encryption of backups.

## Acceptance criteria

- **AC-1** Given the repo, then `docs/backup.md` exists, the README links to it, and it has the six sections from the scope table.
- **AC-2** Given the compose stack with an entry that has a recording, when the backup commands from the guide are run, the volumes are deleted, and the restore commands from the guide are run, then the app starts, the entry is there and its audio file is byte-identical.
- **AC-3** Given `docker/compose.yaml`, then the `db` image is `postgres:<major>` (a number, not `latest`) and the guide names the same major.
- **AC-4** Given the guide's code blocks, then every service and volume name they use exists in `docker/compose.yaml`.

## Test plan

| AC | Unit | Component / UI | API (integration) | E2E | Notes (fixtures, fakes, edge cases) |
|---|---|---|---|---|---|
| AC-1 | read `docs/backup.md` + README, check headings and link | | | | |
| AC-2 | | | | backup / restore script runs the guide's ` ```sh ` blocks marked `backup` and `restore` against the compose stack | needs the Docker image, so it runs in the nightly workflow |
| AC-3 | parse `compose.yaml`, compare with the guide | | | | |
| AC-4 | extract names from code blocks, check against `compose.yaml` | | | | |

## i18n
No UI text. The guide is in English like the other docs.

## Privacy & data
- The guide says backups contain the whole journal (text and audio) in plain form, so they belong somewhere only the owner can read.

## Open questions
None.
