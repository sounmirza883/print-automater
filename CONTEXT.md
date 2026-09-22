# CONTEXT.md — Orientation for anyone (human or agent) picking this repo up

_Last updated: 2026-09-22, at the start of Phase 14._

## What this product is

Print Automated is a printing-management platform. Two PRDs exist in `docs/prd/`:

- `print-automated-master-prd.md` — the **original** PRD. A consumer marketplace: a customer
  uploads a PDF, picks a shop, pays online, the shop accepts on a mobile app, a Windows printer
  agent prints it. **Fully implemented** — Phases 0–13, 101 commits, tag `milestone-pilot-ready-mvp`.
- `Print Automated — Master Product Requirements Document.md` — the **new, authoritative** PRD.
  Keeps the marketplace spine and adds a full print-shop **business operations** layer: counter
  staff, operators, printer managers, an automatic allocation engine, page limits, paper
  inventory, suppliers, a product/pricing catalog, business/automation settings, dashboards,
  search, reports, and a real platform-admin surface.

**When the two PRDs conflict on wording, the new one wins.** Section numbers in commit messages
and comments (e.g. `§19`, `§106`) refer to the new PRD unless a comment says otherwise.

## What is currently being built

`docs/architecture/2026-09-22-prd-v2-alignment.md` is the live implementation plan — Phases 14
onward, continuing the numbering the original plan (`docs/architecture/2026-09-15-design.md`,
Phases 0–13) left off at. Read it before touching anything in Phase 14+.

### Decisions already locked (do not re-litigate these)

| Decision                    | Choice                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship to the old PRD | **Extend** — nothing working is retired                                                                                                                                                               |
| Tenant naming               | `Shop` stays the Prisma model / API / code name; UI copy says "Business"                                                                                                                              |
| Back-office UI              | New `apps/shop-web` (Next.js); `apps/shop-mobile` stays the production-floor app                                                                                                                      |
| Infrastructure              | **Docker only.** No Terraform, no AWS. `infrastructure/terraform/` is deleted in 14.2.                                                                                                                |
| Printer agent               | Being rewritten **natively in C++** (`apps/printer-agent-cpp`), built to parity alongside the existing Node agent (`apps/printer-agent`), which is deleted only once C++ proves it can print for real |
| C++ stack                   | Win32 (`winspool`, `Shell_NotifyIcon`) + libcurl + libsodium + SQLite + nlohmann/json, CMake + vcpkg + MSVC                                                                                           |
| Print filter                | **PDFium linked in-process** — not SumatraPDF (GPLv3, unresolved licensing risk)                                                                                                                      |

## Repo layout

```
apps/
  customer-web/       Next.js — consumer marketplace (built, working)
  shop-mobile/         Expo/React Native — shop production floor (built, working)
  shop-web/             Next.js — owner/admin/back-office (NEW, Phase 23)
  printer-agent/       Node.js Windows agent (built, working — reference impl, deleted at end of Phase 24)
  printer-agent-cpp/  Native C++ Windows agent (NEW, Phase 24)
services/
  api/                 NestJS + Prisma — the backend of record
  worker/              BullMQ background processors
packages/
  api-client/ backend-shared/ config/ design-tokens/ pricing/ types/ validation/
infrastructure/
  docker/              Compose files (dev today; prod added in 14.3)
  terraform/           DELETED in 14.2 — do not recreate
docs/
  prd/                 Both PRDs (see above)
  architecture/        Design docs, newest is authoritative
  definition-of-done.md
```

## Hard invariants — violating these breaks the system silently

1. **`orders.order_status` has exactly one writer**: `packages/backend-shared/src/orders/order-state-machine.ts`.
   Enforced by a `no-restricted-syntax` ESLint rule. Never write it from anywhere else.
2. **(From Phase 18 onward) `print_jobs.status` has exactly one writer**:
   `packages/backend-shared/src/print-jobs/print-job-state-machine.ts`, under a matching ESLint
   rule. The job machine calls the order machine — never the reverse — and always locks the
   `orders` row before any `print_jobs` row.
3. **Tenant isolation is server-side and mandatory.** Every shop-scoped query goes through
   `ShopScopeGuard` / `ShopMembershipService`, or filters by `shopId` manually. No exceptions.
4. **`prisma migrate dev` cannot run in this non-interactive environment.** Hand-write
   `migration.sql` in a fresh timestamped `services/api/prisma/migrations/<ts>_<name>/` folder,
   then `prisma migrate deploy` + `prisma generate`, then verify with `prisma migrate status` and
   a direct `\d <table>` via `docker exec <postgres-container> psql`. **Never `prisma migrate reset`.**
5. **A price change never alters an already-confirmed order** — orders snapshot their pricing at
   confirm time (`orders.pricing_snapshot`); never re-read a live pricing rule for an existing order.
6. **One commit per sub-phase**, only after that sub-phase's stated Done-when condition is
   verified — not just typechecked. This discipline produced the 101 clean commits behind
   `milestone-pilot-ready-mvp`; keep it going.

## Subagents available for this work

`.claude/agents/frontend.md`, `.claude/agents/backend.md`, `.claude/agents/code-reviewer.md` —
scoped to this repo's actual directories (there is no single "frontend folder" or "backend
folder" here, it's a monorepo). Read those files for their exact boundaries before dispatching
work to them. `code-reviewer` is read-only and should run after every backend/frontend change.

## Where to look first for anything

- Full conformance gap analysis (what the new PRD needs vs. what exists today): see the
  "Conformance summary" table in `docs/architecture/2026-09-22-prd-v2-alignment.md`.
- Original build history and hard-won lessons: `~/.claude/projects/.../memory/` on the machine
  this was built on (not part of this repo) — if unavailable, `git log --oneline` and the commit
  messages themselves are thorough (each cites its own Done-when).
