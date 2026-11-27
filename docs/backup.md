# Backup and restore

Your journal is two things on disk. Back up both, together. A backup holds the whole journal (text and audio) in plain
form, so keep it somewhere only you can read. Run every command from the folder with `compose.yaml` (`docker/` in the repo).

## What to back up

| What | Where | Needed? |
|---|---|---|
| Database (entries, users, settings) | `db` service, `nightjar-db` volume | Yes |
| Files (recordings; photos later) | `nightjar-data` volume, `/data` in the app. The files are in `media/` | Yes |
| Transcription models | `nightjar-data` volume, `models/` | No, they download again |

The tar below includes `models/` because it is simpler than leaving it out. Models can be a few hundred MB.

## Back up

The app is stopped for a moment, so the database and the files match. Stop, dump, tar, start:

```sh backup
docker compose stop nightjar
docker compose exec -T db pg_dump -U nightjar -Fc nightjar > nightjar-db.dump
docker compose run --rm --no-deps -T --user root --entrypoint tar -v "$PWD":/backup nightjar czf /backup/nightjar-data.tgz -C /data .
docker compose start nightjar
```

You get two files in the current folder: `nightjar-db.dump` (Postgres custom format) and `nightjar-data.tgz`.
They are a pair. Keep them together and copy them somewhere else, off this machine.

### Every night with cron

Save the block above as `backup.sh` next to `compose.yaml`, then add this with `crontab -e`. It runs at 03:00 and
moves the pair into a dated folder. Inside a crontab `%` must be written `\%`:

```
0 3 * * * cd /srv/nightjar/docker && sh backup.sh && d=/srv/backups/$(date +\%F) && mkdir -p "$d" && mv nightjar-db.dump nightjar-data.tgz "$d"
```

Deleting old backups is up to you.

## Restore

Onto a fresh install: same `compose.yaml` and `.env`, no containers started yet, no volumes (or run
`docker compose down -v` first if you are restoring over an old install; that deletes its data).
Put the pair of backup files in the current folder.

```sh restore
docker compose up -d --wait db
docker compose exec -T db pg_restore -U nightjar -d nightjar --no-owner < nightjar-db.dump
docker compose run --rm --no-deps -T --user root --entrypoint tar -v "$PWD":/backup nightjar xzf /backup/nightjar-data.tgz -C /data
docker compose up -d
```

Do not start `nightjar` before the restore. It would create the tables, and `pg_restore` needs an empty database.
Open the app: sign in with your old account (no setup code needed), your entries are there and the audio plays.

## Before upgrading

Always back up first, then pull:

```
docker compose pull
docker compose up -d
```

Migrations only go forward, so the backup is the way back. To go back, restore (above) with the old image tag.
More on upgrades in the [self-hosting guide](self-hosting.md#9-upgrading).

## Postgres major upgrade

`docker/compose.yaml` pins the major version (`postgres:19`), so `docker compose pull` never upgrades Postgres.
Never just change the tag: the new major will not start on the old volume. To move to a new major:

1. Run the [back up](#back-up) commands.
2. `docker compose down`
3. In `compose.yaml`, change the `db` image tag (for example `postgres:20`) and rename the `nightjar-db` volume
   (both in the `db` service and in the `volumes:` list), for example to `nightjar-db-20`.
4. Run the [restore](#restore) commands. The new `db` starts empty and gets your dump.
5. When all is well, delete the old volume with `docker volume rm` (see `docker volume ls` for its exact name).

## Check your backup

A backup you never restored is a guess. Now and then, restore the pair into a test stack: copy `compose.yaml` and
`.env` to a new folder, change the port (`3000:3000`) and run the restore commands there. Look at a few entries and play
one recording. Then `docker compose down -v` in that folder.
