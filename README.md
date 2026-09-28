# Print Automated

A printing-management platform. Customers upload a document, pick a print
shop, and pay online; the shop accepts the job on a mobile app and a native
Windows printer agent prints it automatically. On top of that marketplace
spine sits a full print-shop business-operations layer: counter staff,
operators, printer managers, automatic job allocation, page limits, paper
inventory, suppliers, a product/pricing catalog, and platform-admin tooling.

See [`CONTEXT.md`](CONTEXT.md) for full orientation, current project status,
and hard architectural invariants before making changes.

## Repo layout

```
apps/
  customer-web/       Next.js — consumer marketplace
  shop-mobile/         Expo/React Native — shop production floor app
  shop-web/             Next.js — owner/admin back-office
  marketing-web/        Next.js — marketing site
  printer-agent-cpp/   Native C++ Windows printer agent (built separately, see its own README)
services/
  api/                 NestJS + Prisma — backend of record
  worker/              BullMQ background processors
packages/
  api-client/ backend-shared/ config/ design-tokens/ pricing/ types/ validation/
infrastructure/
  docker/              Docker Compose files for local/dev/prod
docs/
  prd/                 Product requirements documents
  architecture/        Design docs (newest is authoritative)
  definition-of-done.md
```

## Prerequisites

- Node.js >= 22
- pnpm 9.15.4 (via `packageManager` / corepack)
- Docker (for local Postgres/Redis)

## Getting started

```bash
pnpm install
pnpm dev:up        # start Postgres/Redis via Docker Compose
pnpm db:migrate    # run Prisma migrations
pnpm db:seed       # seed local data
pnpm dev           # run all apps/services in dev mode
```

## Common scripts

| Command                                              | Description                                         |
| ---------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                           | Run all apps/services in dev mode (turbo, parallel) |
| `pnpm build`                                         | Build all packages                                  |
| `pnpm lint`                                          | Lint all packages + verify lint guards              |
| `pnpm typecheck`                                     | Type-check all packages                             |
| `pnpm test`                                          | Run unit/integration tests                          |
| `pnpm test:e2e`                                      | Run end-to-end tests                                |
| `pnpm format`                                        | Format the repo with Prettier                       |
| `pnpm dev:up` / `pnpm dev:down`                      | Start/stop local Docker infra                       |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Prisma database workflows                           |

The native C++ printer agent (`apps/printer-agent-cpp`) is not part of the
pnpm workspace; build it with its own `build.ps1` — see that app's README.

## Documentation

- [`CONTEXT.md`](CONTEXT.md) — orientation, current state, invariants
- `docs/prd/` — product requirements (the master PRD in `docs/prd/` is authoritative)
- `docs/architecture/` — implementation plans and design docs
- `docs/definition-of-done.md` — PRD conformance / acceptance criteria
