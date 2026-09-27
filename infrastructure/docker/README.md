# infrastructure/docker

Three compose files, one job each:

| File                      | Purpose                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.dev.yml`  | Local dev infra only (Postgres/Redis/MinIO/MailHog/ClamAV) -- apps run via `pnpm dev` against it directly.            |
| `docker-compose.apps.yml` | Verifies the built api/worker/web images against the dev stack (§12.6). Not for production use.                       |
| `docker-compose.prod.yml` | **The full production stack** (14.3) -- api, worker, customer-web, shop-web, postgres, redis, minio, clamav, mailhog. |

## Why Docker Compose and not Terraform/AWS

Phases 0-13 provisioned RDS, ElastiCache, S3, SES and ECS Fargate via
`infrastructure/terraform/` (deleted in 14.2). Phase 14 replaces all of
that with a self-contained Docker Compose stack on a single host:
Postgres/Redis/MinIO containers with named volumes stand in for
RDS/ElastiCache/S3, and `KMS_PROVIDER=local`
(`packages/backend-shared/src/kms/`, already built for dev) is the
production key-management choice, not a dev-only fallback. See
`CONTEXT.md` and `docs/architecture/2026-09-22-prd-v2-alignment.md`
for the full reasoning and the risks this trades away (no managed-
service SLA, no automatic failover, no vendor-run backups -- see
"Backups" below).

## Bringing the prod stack up

1. Copy the env template and fill in real values:

   ```
   cp infrastructure/docker/.env.prod.example infrastructure/docker/.env.prod
   ```

   Every `${VAR:?message}` in `docker-compose.prod.yml` is a required
   secret with no safe default -- `docker compose up` refuses to start
   if one is missing, rather than silently booting with a dev
   placeholder.

2. Bring the stack up (builds api/worker/customer-web/shop-web locally from
   this repo's own Dockerfiles unless `API_IMAGE`/`WORKER_IMAGE`/
   `CUSTOMER_WEB_IMAGE`/`SHOP_WEB_IMAGE` are set to point at already-built registry
   images -- see `.github/workflows/deploy-staging.yml`, 14.4):

   ```
   docker compose --env-file infrastructure/docker/.env.prod \
     -f infrastructure/docker/docker-compose.prod.yml up -d --build
   ```

3. Run migrations once the `api` image exists (before or right after
   first boot -- Prisma migrations in this project are additive/
   forward-only, safe to run ahead of the code that depends on them):

   ```
   docker compose --env-file infrastructure/docker/.env.prod \
     -f infrastructure/docker/docker-compose.prod.yml \
     run --rm api pnpm --filter @print-automated/api exec prisma migrate deploy
   ```

4. Confirm readiness:
   ```
   curl -f http://localhost:${API_HOST_PORT:-3000}/v1/health/ready
   ```
   200 with `{"status":"ready",...}` means Postgres, Redis and MinIO
   (S3) are all genuinely reachable from inside the `api` container --
   not just that the container process started.

## SMTP relay

`docker-compose.prod.yml` ships a `mailhog` service as the default
`SMTP_HOST` **placeholder only** -- MailHog is a mail _catcher_ (it
never delivers to a real inbox), fine for proving the stack boots end
to end but not for production email deliverability. Before going live,
point `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_SECURE`
in `.env.prod` at a real SMTP relay and remove the `mailhog` service --
no application code changes needed, since `SmtpEmailTransport` (14.5,
`packages/backend-shared/src/notifications/smtp-email-transport.ts`)
speaks plain SMTP via `nodemailer` to whatever host is configured.
**Which relay to use is a real business decision this plan
deliberately does not make** (a specific commercial provider, or
self-hosting one) -- flagged for a human to pick.

## Backups (§104, plan risk #4)

Losing RDS/S3's managed backups and durability guarantees is an
explicit, named risk of the Docker-only move -- this is the mitigation
required to close it, not optional operational nice-to-have.

**Postgres -- manual backup:**

```
docker compose --env-file infrastructure/docker/.env.prod \
  -f infrastructure/docker/docker-compose.prod.yml \
  exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom > backup-$(date +%Y%m%d-%H%M%S).dump
```

**Postgres -- restore** (against a fresh/empty database -- never run
this against a database with data you want to keep):

```
docker compose --env-file infrastructure/docker/.env.prod \
  -f infrastructure/docker/docker-compose.prod.yml \
  exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < backup-20260101-030000.dump
```

**Scheduling it:** run the backup command above from the host's own
cron (or systemd timer) rather than a container inside this compose
project, so the dump survives even if the whole stack is recreated:

```
# /etc/cron.d/print-automated-pg-backup -- daily at 03:00, keep 14 days
0 3 * * * root cd /opt/print-automated && \
  docker compose --env-file infrastructure/docker/.env.prod \
  -f infrastructure/docker/docker-compose.prod.yml \
  exec -T postgres pg_dump -U print_automated -d print_automated --format=custom \
  > /var/backups/print-automated/pg-$(date +\%Y\%m\%d).dump && \
  find /var/backups/print-automated -name 'pg-*.dump' -mtime +14 -delete
```

Ship dumps off-host too (object storage on a different provider than
the one hosting this Docker host, or at minimum a different disk) --
a `pg_dump` sitting on the same host as the database it backs up
survives a bad migration but not a lost host.

**MinIO (documents):** `minio_data` is a named Docker volume. Either
snapshot the underlying host directory Docker stores it in
(`docker volume inspect print-automated-prod_minio_data`) on the same
schedule as the Postgres dump, or run `mc mirror` from the `minio`
service to a second bucket/host for continuous replication -- not set
up by default here, since it is a genuine operational choice (cost vs.
recovery-point-objective) rather than something this plan can decide
for a production deployment it has never seen the traffic or budget
of.

## Resource limits

`api`/`worker`/`customer-web`/`shop-web` each set `deploy.resources.limits`
(`cpus`/`memory`) -- honored by plain `docker compose up` on the
Compose Specification this file uses (no Swarm required), not just a
Swarm-only hint. Tune these for the real host's actual capacity;
the values here are conservative starting points, not measured
production numbers.

## shop-web (back office, 23.17)

`shop-web` (apps/shop-web, port `SHOP_WEB_HOST_PORT`, default 3002) is built
from `shop-web.Dockerfile`, mirrors `customer-web`, has a container
healthcheck (`GET /` on 3002) and the same 512m/1 CPU limits. There is no
reverse proxy in this stack: put TLS and the `shop.<domain>` route on
whatever fronts the host. It calls the API server-to-server, so it needs no
`CORS_ALLOWED_ORIGINS` entry, and it starts only once the API's healthcheck
passes.

**Published on loopback only (23.20):** the port is bound to
`SHOP_WEB_BIND_ADDRESS`, default `127.0.0.1`, because the back office carries
staff session cookies and this stack terminates no TLS. The host's reverse
proxy forwards `https://shop.<domain>` to `127.0.0.1:3002`. Set it to
`0.0.0.0` only when something else terminates TLS in front of the port.

**Scaling:** its refresh-and-retry single-flight is in-process (per browser
tab) and the API rotates refresh tokens with reuse detection. Run one
instance, or configure sticky sessions on the reverse proxy if you run more
than one, so two instances do not race a refresh for the same session.

**CI/deploy wiring is NOT in this commit** (the workflows are outside this
directory): see "CI change needed" in
docs/architecture/2026-09-22-prd-v2-alignment.md.
