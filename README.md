# Print Automated

A printing-management platform for print shops. A customer uploads a document,
picks a shop, configures the print and pays online. The shop accepts the order
on a mobile app, and a native Windows **printer agent** prints it automatically
on the right printer.

On top of that marketplace spine sits a full **print-shop business-operations
layer**: counter staff, operators, printer managers, an automatic job
allocation engine, per-printer page limits and failover, paper inventory,
suppliers and purchase orders, a product/pricing catalog, automation settings,
dashboards, reports, search, and a platform-admin surface.

> New to the repo? Read [`CONTEXT.md`](CONTEXT.md) first. It holds the current
> status, the locked decisions and the hard invariants that must not be broken.

---

## Table of contents

1. [Project timeline](#project-timeline)
2. [How it works](#how-it-works)
3. [Features](#features)
4. [Architecture and tech stack](#architecture-and-tech-stack)
5. [Repository structure](#repository-structure)
6. [Getting started](#getting-started)
7. [Scripts](#scripts)
8. [Testing](#testing)
9. [Infrastructure and deployment](#infrastructure-and-deployment)
10. [Hard invariants](#hard-invariants)
11. [Current status and known gaps](#current-status-and-known-gaps)
12. [Documentation map](#documentation-map)

---

## Project timeline

The project started on **2026-09-15** with a baseline PRD and design doc, and
has been built in numbered phases, one verified commit per sub-phase (350+
commits so far).

| Phase    | Dates     | What was built                                                                                                                                                                                                                                               |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 - 13   | Sep 15 -> | **Original marketplace MVP**: monorepo scaffold, auth, shops, documents, pricing, orders, payments, worker queues, customer web, shop mobile app, Node printer agent. Tagged `milestone-foundation`, `milestone-order-and-pay`, `milestone-pilot-ready-mvp`. |
| 14       | Sep 22    | Context files, Docker-only infrastructure (Terraform removed), production Compose, SMTP transport                                                                                                                                                            |
| 15       | Sep 22-23 | Domain expansion: paper sizes/types, finishing, printer profiles, order items, customer records, heartbeat v2                                                                                                                                                |
| 16       | Sep 23    | Roles and permissions (RBAC), staff management, platform admin API, audit expansion                                                                                                                                                                          |
| 17       | Sep 23    | Products, pricing engine v2, counter-placed orders, manual payments, invoices and receipts                                                                                                                                                                   |
| 18       | Sep 24    | **The spine**: print-job state machine, order-item explosion, allocation engine, blocked jobs, queue priority, operator allocation                                                                                                                           |
| 19       | Sep 24    | Page limits, automatic failover, queue recovery                                                                                                                                                                                                              |
| 20       | Sep 25    | Inventory, stock movements, low-stock alerts, suppliers, purchase orders                                                                                                                                                                                     |
| 21       | Sep 25    | Pause/resume, failure reasons, quality check, reprint, delivery, JPG/PNG and DOCX uploads                                                                                                                                                                    |
| 22       | Sep 25    | Business settings and automation toggles, printer automation rules                                                                                                                                                                                           |
| 23       | Sep 25-28 | `shop-web` back-office, dashboards, reports, search, notification centre, mobile production floor                                                                                                                                                            |
| 24       | Sep 28    | **Native C++ printer agent** (PDFium, DPAPI, SQLite ledger, Inno Setup installer); Node agent retired                                                                                                                                                        |
| 25       | Sep 28    | Acceptance and hardening: PRD scenario suite, concurrency suite, authorization matrix, definition of done                                                                                                                                                    |
| After 25 | Oct 2026  | Ongoing: agent native dashboard windows (staff login, Orders/Queue), mobile QR/barcode order scan, shared design tokens and theme                                                                                                                            |

---

## How it works

### The order journey

```
Customer (customer-web)                      Shop                          Shop PC
-----------------------                      ----                          -------
1. Open shop page (/s/<shopId>)
2. Upload PDF / DOCX / JPG / PNG
        |  (virus-scanned, converted to PDF by the worker)
3. Configure print: size, colour, sides,
   copies, paper type, finishing
4. Price is calculated and SNAPSHOTTED
5. Pay online                          ->  6. Order appears in shop-mobile /
                                              shop-web queue
                                           7. Shop accepts the order
                                              (allocation engine explodes the order
                                               into print jobs and picks a printer
                                               per job)
                                                                          ->  8. C++ agent claims the job,
                                                                              downloads the document,
                                                                              prints via PDFium + Windows
                                                                              spooler, reports status
                                           9. Quality check (optional)  <-
                                          10. Ready / delivered
11. Customer is notified at every step
```

### The pieces and how they talk

- **Web and mobile apps** talk only to the **API** (`services/api`).
- The **API** is the single backend of record: it owns the database
  (PostgreSQL via Prisma), authorization, state machines and pricing.
- Slow or scheduled work runs in the **worker** (`services/worker`) on BullMQ
  queues over Redis: document processing, notifications, order expiration,
  print timeouts, printer-offline sweeps, low-stock alerts, retention.
- The **printer agent** on the shop's Windows PC pairs once with a pairing
  code, then authenticates with a signed challenge (Ed25519). It long-polls
  for jobs, atomically claims one, prints it, and reports status back. A local
  SQLite ledger guarantees the same job is never printed twice, even if the
  agent is killed mid-print.

### The allocation engine

When an order is accepted it is split into per-item **print jobs**. A pure
function, `allocatePrinter()`, picks the printer for each job by checking:
printer status, capabilities, paper size and type, colour, duplex, page
capacity, queue depth, page limit, paper availability and operator
availability. If nothing fits, the job is **blocked** with an explicit reason
(`NO_COMPATIBLE_PRINTER`, `PRINTER_OFFLINE`, `PAGE_LIMIT_REACHED`, `NO_PAPER`, ...).
When a printer hits its page limit, goes offline or runs out of paper, jobs
fail over automatically to another suitable printer. Every automatic path
respects the shop's automation toggles, and every manual override is audited.

---

## Features

### Customers

- Browse a shop and upload documents (PDF, DOCX, JPG, PNG)
- Configure print options and see a live price
- Pay online, track order status, download invoices/receipts
- Notifications and a notification centre

### Shop staff (counter, operators, printer managers, managers, owners)

- Place **counter orders** on behalf of walk-in customers; record cash/offline payments
- Customer records (shop-scoped) with search
- Live queue with priority (normal / high / urgent), blocked-job reasons, manual allocation
- Job actions: pause, resume, fail with reason, reprint, quality check
- Optional delivery workflow (address, courier, tracking, fee)
- Printer management: profiles, capabilities, maintenance status, page limits
- Inventory with stock movements and low-stock alerts; suppliers and purchase orders
- Product catalog and pricing rules; business and automation settings
- Staff invites and role management
- Dashboards (owner, operator, printer), reports, search and filters
- Role-based permissions (`OWNER`, `MANAGER`, `COUNTER`, `OPERATOR`, `PRINTER_MANAGER`, ...)

### Platform admin

- Businesses, users, audit log and system health

### Printer agent (Windows)

- Pairs with a shop, reports real printer capabilities, prints jobs automatically
- Duplicate-print protection via a fsync'd SQLite ledger
- Tray icon, status window, and native Orders/Queue windows with staff login
- Installer built with Inno Setup

---

## Architecture and tech stack

| Layer                           | Technology                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Monorepo                        | pnpm 9 workspaces, Turborepo, TypeScript, ESLint, Prettier, Husky + lint-staged                                        |
| API                             | NestJS 11, Prisma 6, PostgreSQL 16                                                                                     |
| Worker                          | NestJS, BullMQ 5, Redis 7                                                                                              |
| Web apps                        | Next.js 15, React 19 (App Router, BFF proxy pattern)                                                                   |
| Mobile                          | Expo / React Native (Expo Router, secure token storage, barcode/QR scan)                                               |
| Printer agent                   | C++20, Win32 (`winspool`, `Shell_NotifyIcon`), libcurl, libsodium, SQLite, nlohmann/json, PDFium; CMake + vcpkg + MSVC |
| Storage / mail / scanning (dev) | MinIO (S3-compatible), MailHog, ClamAV                                                                                 |
| Payments                        | Provider interface; `mock` provider by default in development                                                          |
| Tests                           | Jest (unit + e2e), Catch2 (C++), Playwright                                                                            |
| Infra                           | Docker Compose only (dev, prod, apps)                                                                                  |

---

## Repository structure

```
apps/
  customer-web/        Next.js - consumer marketplace (upload, configure, pay, track)
  shop-web/            Next.js - owner/admin back-office console
  shop-mobile/         Expo/React Native - shop production-floor app
  marketing-web/       Next.js - marketing site
  printer-agent-cpp/   Native C++ Windows printer agent (NOT in the pnpm workspace;
                       built with its own build.ps1 - see its README)
services/
  api/                 NestJS + Prisma - backend of record (auth, orders, payments,
                       printers, inventory, reports, admin, ...)
  worker/              BullMQ processors (document processing, notifications,
                       expiration, print timeout, offline sweep, low stock, retention)
packages/
  api-client/          Typed API client shared by the front ends
  backend-shared/      State machines and shared backend logic
  config/              Environment/config schemas
  design-tokens/       Colors, spacing, theme shared by web and mobile
  pricing/             Pure pricing engine
  types/               Shared enums and types
  validation/          Shared validation schemas
infrastructure/
  docker/              Compose files (dev, apps, prod) and Dockerfiles
  scripts/             Ops scripts
scripts/               Repo-level scripts (lint-guard verification)
docs/
  prd/                 Product requirements documents
  architecture/        Design docs and phase plans (newest is authoritative)
  definition-of-done.md  PRD conformance matrix
```

Notable API modules in `services/api/src`: `auth`, `shops`, `shop-staff`,
`shop-orders`, `public-orders`, `documents`, `pricing-rules`, `products`,
`payments`, `invoices`, `printers`, `printer-rules`, `print-jobs`, `agents`,
`shop-agents`, `inventory`, `suppliers`, `purchase-orders`, `deliveries`,
`dashboard`, `reports`, `analytics`, `notification-center`, `audit`, `admin`.

---

## Getting started

### Prerequisites

- Node.js >= 22
- pnpm 9.15.4 (via `packageManager` / corepack)
- Docker (PostgreSQL, Redis, MinIO, MailHog, ClamAV for local dev)
- For the printer agent only: Windows, Visual Studio Build Tools with
  _Desktop development with C++_, and vcpkg

### Run locally

```bash
pnpm install
cp services/api/.env.example services/api/.env   # then adjust values
pnpm dev:up        # start Postgres/Redis/etc. via Docker Compose
pnpm db:migrate    # apply Prisma migrations
pnpm db:seed       # seed local data (shops, users, pricing)
pnpm dev           # run all apps/services in dev mode
```

### Build the printer agent (Windows)

```powershell
cd apps/printer-agent-cpp
./build.ps1          # configure + build + run tests (release)
```

Output: `build/windows-x64/print-automated-agent.exe` (+ `pdfium.dll`).
Full details are in [`apps/printer-agent-cpp/README.md`](apps/printer-agent-cpp/README.md).

---

## Scripts

| Command                                              | Description                                         |
| ---------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev`                                           | Run all apps/services in dev mode (turbo, parallel) |
| `pnpm build`                                         | Build all packages                                  |
| `pnpm lint`                                          | Lint all packages and verify lint guards            |
| `pnpm typecheck`                                     | Type-check all packages                             |
| `pnpm test`                                          | Unit/integration tests                              |
| `pnpm test:e2e`                                      | End-to-end tests                                    |
| `pnpm format` / `pnpm format:check`                  | Prettier write / check                              |
| `pnpm dev:up` / `pnpm dev:down`                      | Start/stop local Docker infrastructure              |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Prisma database workflows                           |

---

## Testing

- **Unit tests** live beside the code (`*.spec.ts`).
- **E2E suites** are in `services/api/test` and cover auth, orders, payments,
  agents, authorization, idempotency, failover, inventory and more. Highlights:
  - `acceptance-106.e2e-spec.ts` - the 8 PRD acceptance scenarios
  - `concurrency-100.e2e-spec.ts` - concurrent allocation, inventory and job mutation
  - `authorization-matrix-v2.e2e-spec.ts` - roles x resources matrix
- E2E uses Redis logical DB 9 so it never touches dev data on DB 0. Run jest
  directly from the service folder, for example:
  `cd services/api && node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand <name>`
- The C++ agent has Catch2 tests, including real prints through the
  _Microsoft Print to PDF_ driver.

---

## Infrastructure and deployment

Docker only (no Terraform, no cloud-vendor lock-in).

- `infrastructure/docker/docker-compose.dev.yml` - local Postgres, Redis, MinIO, MailHog, ClamAV
- `infrastructure/docker/docker-compose.apps.yml` - the apps themselves
- `infrastructure/docker/docker-compose.prod.yml` - production stack with named volumes and healthchecks
- Dockerfiles for `api`, `worker`, web apps and `shop-web`
- CI in `.github/workflows` (lint, typecheck, tests, Windows build for the agent, SSH + Compose deploy gated on `/health/ready`)

---

## Hard invariants

Breaking these fails silently. Details in [`CONTEXT.md`](CONTEXT.md).

1. `orders.order_status` has **one writer**: `order-state-machine.ts` (ESLint-enforced).
2. `print_jobs.status` has **one writer**: `print-job-state-machine.ts`. The job machine calls the order machine, never the reverse.
3. **Tenant isolation is server-side and mandatory** - every shop-scoped query goes through `ShopScopeGuard` or filters by `shopId`.
4. **A price change never alters a confirmed order** - orders snapshot pricing at confirmation.
5. Migrations are hand-written SQL, applied with `prisma migrate deploy`. Never run `prisma migrate reset` against a shared DB.

---

## Current status and known gaps

All planned phases (14-25) are complete and verified, and the original
marketplace MVP is tagged `milestone-pilot-ready-mvp`.

Known gaps and notes:

- **No self-service business signup.** Shops are provisioned via seed/ops;
  there is no endpoint a prospective business can call to create itself.
  Everything downstream of a shop existing is built and tested.
- Online payments run on a **mock provider** by default; a real PSP
  integration plugs in behind the payment-provider interface.
- Real-hardware printing has been validated against _Microsoft Print to PDF_;
  validation on physical printers is still pending.
- DOCX conversion (LibreOffice in the worker) needs production verification.

---

## Documentation map

- [`CONTEXT.md`](CONTEXT.md) - orientation, current state, invariants, shared-machine rules
- [`docs/prd/`](docs/prd) - original and new master PRDs (the new one is authoritative)
- [`docs/architecture/2026-09-15-design.md`](docs/architecture/2026-09-15-design.md) - original design (Phases 0-13)
- [`docs/architecture/2026-09-22-prd-v2-alignment.md`](docs/architecture/2026-09-22-prd-v2-alignment.md) - Phases 14-25 plan and outcomes
- [`docs/definition-of-done.md`](docs/definition-of-done.md) - PRD conformance matrix
- [`apps/printer-agent-cpp/README.md`](apps/printer-agent-cpp/README.md) - building and running the agent
- [`infrastructure/docker/README.md`](infrastructure/docker/README.md) - Docker setup
