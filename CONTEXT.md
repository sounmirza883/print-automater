# CONTEXT.md — Orientation for anyone (human or agent) picking this repo up

_Last updated: 2026-09-24, during Phase 18's review fixes. For exact state use `git log --oneline`; the plan is docs/architecture/2026-09-22-prd-v2-alignment.md._

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

| Decision                    | Choice                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relationship to the old PRD | **Extend** — nothing working is retired                                                                                                                     |
| Tenant naming               | `Shop` stays the Prisma model / API / code name; UI copy says "Business"                                                                                    |
| Back-office UI              | New `apps/shop-web` (Next.js); `apps/shop-mobile` stays the production-floor app                                                                            |
| Infrastructure              | **Docker only.** No Terraform, no AWS. `infrastructure/terraform/` is deleted in 14.2.                                                                      |
| Printer agent               | **Native C++** (`apps/printer-agent-cpp`, Phase 24). The Node agent was deleted in 24.15 once the C++ one had printed a real job and passed the parity gate |
| C++ stack                   | Win32 (`winspool`, `Shell_NotifyIcon`) + libcurl + libsodium + SQLite + nlohmann/json, CMake + vcpkg + MSVC                                                 |
| Print filter                | **PDFium linked in-process** — not SumatraPDF (GPLv3, unresolved licensing risk)                                                                            |

## Repo layout

```
apps/
  customer-web/       Next.js — consumer marketplace (built, working)
  shop-mobile/         Expo/React Native — shop production floor (built, working)
  shop-web/             Next.js — owner/admin/back-office (NEW, Phase 23)
  printer-agent-cpp/   Native C++ Windows agent (Phase 24; not in the pnpm workspace:
                       build with its build.ps1, see its README)
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

## Shared-machine rules (several sessions and subagents run here at once)

Multiple Claude sessions and subagents work on this one machine, against the same dev Postgres (`localhost:5433`) and Redis (`localhost:6380`). Treat everything you did not start as somebody else's live work.

1. **Never kill a process you did not spawn yourself and record the PID of.** Never kill by image name (`/IM node.exe`), by command-line/path match, or because something "looks stale". Incident, 2026-09-24: a subagent killed another session's `services/api` and `services/worker` dev servers by PID six times in ~15 minutes (each time they were restarted it killed them again), because it could not tell a live server from a leftover. The auto-mode classifier did not stop it — do not rely on it as the guard.
2. **If someone else's process blocks you** (a held port, the Prisma `query_engine-windows.dll.node` giving EPERM on `prisma generate`, or a running `services/worker` consuming the shared Redis `notifications` queue and making e2e tests fail with `Expected length: 1, Received length: 0`): do not kill it. Find the owner with `ListAgents`, ask them via `SendMessage`, run the affected suites when it is down, or run them in isolation and report the result as "possible interference". A `prisma generate` EPERM on the final native-binary rename is not a blocker: the TypeScript output has already regenerated and the same-version binary works.
3. **Never bulk-delete rows in the shared dev database.** Leftovers from interrupted e2e runs (for example `authz-matrix-*` fixture users/shops that make `authorization-matrix.e2e-spec.ts`'s `afterAll` fail on `agent_pairing_codes_created_by_fkey`) are diagnosed and reported, not force-cleaned.
4. **The git index is shared: run only one committing agent at a time.** A working tree has ONE index and `git commit` takes everything staged, so two agents that both stage-then-commit can sweep each other's files even when each stages only its own. Incident, 2026-09-24: a frontend agent's commit `32ddb5b` ("18.13 ...customer-web and shop-mobile") also committed three of a parallel backend agent's already-staged files, so that fix landed under a message that does not describe it. Parallelism is safe for one committer plus read-only agents (reviewers). Before every commit run `git diff --cached --stat` and confirm only your files are staged; after an agent finishes, `git show --stat <hash>` to confirm the commit holds only what its message says.
5. **Run e2e directly, and in isolation.** e2e suites use Redis logical database 9 by default (`services/*/jest.setup.cjs`); dev servers stay on database 0, so never point a dev server at database 9. `redis-cli -n 9 FLUSHDB` is safe (test data only) and **is the first thing to try when a worker e2e suite hangs with no DB activity**: hundreds of stale `notifications` jobs accumulate in DB 9 across runs, the worker app under test consumes them at boot and `app.close()` never returns (2026-09-24: `print-timeout` hung 3x for the round-3 agent and for me; after FLUSHDB it passed 9/9 in 7s, so it was NOT a code regression); `E2E_REDIS_DB=0` opts out. Postgres is still shared with dev. Launch e2e as `cd services/<x> && timeout <secs> node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand <names>`, never through `pnpm exec` / `cmd` wrappers: a hung wrapper chain orphans its child (a hung jest burned a CPU core for hours on 2026-09-24, and only a machine restart removed it), whereas `timeout` kills the real jest process.
6. **When you dispatch a subagent, put rules 1-4 and 6 in its prompt.** Subagents read project memory and act on "kill stale servers" advice literally.

7. **Never use the dev `DATABASE_URL` as `--shadow-database-url`.** Prisma drops the schema in a shadow DB (this wiped the shared dev DB on 2026-09-24; only seed data was restored). Check drift read-only: `prisma migrate diff --from-url <dev> --to-schema-datamodel prisma/schema.prisma`.
