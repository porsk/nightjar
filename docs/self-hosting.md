# Self-hosting

Nightjar with Docker Compose, behind Traefik, on a subdomain, with Cloudflare in front (proxied, orange cloud).
This is one possible setup, written from the config code and not tried on a live server. The plain local install is in the [README](../README.md).

## 1. Files

```
cd docker
cp .env.example .env
```

`.env` has one setting:

| Variable | What |
|---|---|
| `POSTGRES_PASSWORD` | Password for the bundled Postgres. Required, compose refuses to start without it. Use a long random one |

Image tag in `docker/compose.yaml`:

| Tag | Use it when |
|---|---|
| `porsk/nightjar:0.1.0` | You want upgrades only when you choose. Recommended |
| `porsk/nightjar:latest` | You are fine with every `pull` moving you to the newest release |

## 2. Volumes

| Volume | Path in container | What lives there |
|---|---|---|
| `nightjar-db` | `/var/lib/postgresql` (db) | The database: entries, users, settings |
| `nightjar-data` | `/data` (nightjar) | Files on disk (recordings, media) |

Back both up (see Upgrading).

## 3. Traefik

Remove the `ports:` section from the `nightjar` service (Traefik reaches it on the Docker network) and join Traefik's
network. Example, with `traefik` as the external network name and `journal.example.com` as your subdomain. Use your
own network, entrypoint and cert resolver names:

```yaml
services:
  nightjar:
    image: porsk/nightjar:0.1.0
    networks: [default, traefik]
    labels:
      - traefik.enable=true
      - traefik.docker.network=traefik
      - traefik.http.routers.nightjar.rule=Host(`journal.example.com`)
      - traefik.http.routers.nightjar.entrypoints=websecure
      - traefik.http.routers.nightjar.tls=true
      - traefik.http.routers.nightjar.tls.certresolver=letsencrypt
      - traefik.http.services.nightjar.loadbalancer.server.port=3000

networks:
  traefik:
    external: true
```

Traefik passes the original `Host` header to the app by default. Sign-in checks the request origin against it, so do
not rewrite the Host header in a middleware.

## 4. Cloudflare

| Setting | Value | Why |
|---|---|---|
| DNS record | `journal` proxied (orange cloud) | |
| SSL/TLS mode | **Full (strict)** | The app must see `https`. With Flexible, Cloudflare talks plain http to Traefik, the app sees http, secure cookies are not set and sign-in breaks |

Full (strict) needs a valid certificate on Traefik (Let's Encrypt works, or a Cloudflare Origin certificate).

## 5. Client IP and `NIGHTJAR_TRUST_PROXY`

The app uses the client IP for the login rate limit. `NIGHTJAR_TRUST_PROXY` is how many proxy hops it trusts for
`X-Forwarded-For` (0 to 10, default 0). Add it to the `nightjar` service:

```yaml
    environment:
      NIGHTJAR_TRUST_PROXY: '2'
```

| Setup | Value |
|---|---|
| Traefik only, no Cloudflare | `1` |
| Cloudflare + Traefik | `2` (Cloudflare is hop 2, Traefik is hop 1) |
| Port 3000 published directly, no proxy | `0` (default) |

With Cloudflare in front, Traefik must also trust Cloudflare, or it drops the forwarded headers and every visitor
looks like a Cloudflare address (then the login limits are shared by everyone). In Traefik's static config, on the
entrypoint, set `forwardedHeaders.trustedIPs` to [Cloudflare's IP ranges](https://www.cloudflare.com/ips/):

```yaml
entryPoints:
  websecure:
    address: ':443'
    forwardedHeaders:
      trustedIPs:
        - 173.245.48.0/20
        # ... all ranges from https://www.cloudflare.com/ips/ (IPv4 and IPv6)
```

Copy the full current list from that page. It changes rarely, so re-check it now and then.

Check it: the app does not log client IPs, so look at Traefik instead. In Traefik's access log, `ClientHost` should be a
real visitor address, not a Cloudflare one. If it shows Cloudflare addresses, `trustedIPs` is missing or incomplete.
A wrong `NIGHTJAR_TRUST_PROXY` has no visible sign in the app logs, so keep it to the table above.

## 6. First start

```
docker compose up -d
docker compose logs nightjar
```

The log has a line `setup code for the first account` with an 8 character code. Open your domain, and enter the
code on the setup screen to create the first account.

## 7. Health and metrics

| What | Where |
|---|---|
| `/healthz` | Process is up. Also used by the Docker healthcheck |
| `/readyz` | Database reachable and migrations done. 503 while starting or when the database is down |
| Metrics | Prometheus format, internal port `9464` (`NIGHTJAR_METRICS_PORT`), path `/metrics`. Not published, keep it that way |

Scrape from a Prometheus on the same Docker network (see [engineering](engineering.md)):

```yaml
scrape_configs:
  - job_name: nightjar
    static_configs:
      - targets: ['nightjar:9464']
```

## 8. Limits

| Limit | Detail |
|---|---|
| Cloudflare free plan | Request bodies are capped at 100 MB. Larger uploads fail at Cloudflare before they reach Nightjar |

## 9. Upgrading

Back up first. Migrations run automatically on start and only go forward, so the backup is the way back.

```
docker compose exec -T db pg_dump -U nightjar -Fc nightjar > nightjar-$(date +%F).dump
docker run --rm -v nightjar_nightjar-data:/data -v "$PWD":/backup alpine tar czf /backup/nightjar-data-$(date +%F).tgz -C /data .
```

The volume name has your compose project prefix (here `nightjar_`). Check with `docker volume ls`.

Then change the tag if you pin one, and:

```
docker compose pull
docker compose up -d
```

## 10. Not in this version yet

Transcription and voice recording come in a later release. Today you can write text entries. See the
[roadmap](roadmap.md).
