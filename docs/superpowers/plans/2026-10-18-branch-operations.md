# Branch-scoped operations (step 3): plan for two parallel agents

> **For the agents:** you are the `backend` agent or the `frontend` agent (see `.claude/agents/`). Read the section for your track, the shared contract, and the working rules. Steps use checkbox syntax. The **coordinator** (the main session) is the only one who commits.

**Goal:** Orders, print jobs, printers and paired PCs belong to a branch. A branch-bound person only ever sees and touches their own branch; an owner (or an "All branches" person) sees everything and can narrow any list to one branch. Each branch has its own QR code, and a customer who scans it orders from that branch. Printing never crosses branches.

**Spec:** `docs/superpowers/specs/2026-10-17-branches-and-staff-access-design.md`, Part 2: "Orders", "Printing, paper and agents", "Notifications", "UI (shop-web)", and delivery step 3. Steps 1 (per-person access) and 2 (branch foundation: `branches` table, who works where, Branches page) are already built on this branch; their plans are `2026-10-17-staff-access-edit.md` and `2026-10-17-branch-foundation.md`.

## Out of scope (later steps, do not start)

- Stock, paper consumption, purchase orders and low-stock alerts per branch (step 4). **Paper stays business-wide in this step**: do not touch `paper-availability.ts` or `consume-paper.ts` beyond passing the same shop id they take today.
- Dashboards, reports and the live dashboard stream by branch (step 5).
- A shop-mobile branch picker. A counter-order screen (none exists in any app; counter orders are API only today).

## Working rules (both agents, non-negotiable)

1. **Never run `git add`, `git commit`, `git stash`, `git checkout`, `git reset`, `git clean` or any push.** Leave every change in the working tree. The coordinator reviews and commits. Two agents in one working tree share one git index; a commit by either would sweep the other's files in.
2. **Stay in your scope** (from your agent definition). The other agent is editing the other side of the repo at the same time: never touch, revert, reformat or "fix" files outside your scope, and run lint/format only on your own files. If you need a change outside your scope, stop that item and report it as a **contract gap** (exact file, exact change).
3. **Do not edit `packages/api-client`, `packages/validation` or `packages/types` if you are the frontend agent.** The coordinator has already added the shared contract to `packages/api-client` (below). The backend agent may extend `packages/api-client` / `packages/validation` / `packages/types` only to match the contract; it must not rename or remove anything the contract defines.
4. **Do not use turbo-backed `pnpm --filter ... typecheck|test|build` commands** (they rebuild shared packages and the two agents would race on `dist`). Use direct commands from the package folder instead:
   - typecheck: `node ../../node_modules/typescript/bin/tsc --noEmit` (API: `-p tsconfig.typecheck.json`, which includes the specs)
   - unit tests: `node ../../node_modules/jest/bin/jest.js <pattern>`
   - API e2e: `cd services/api && timeout 300 node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand --silent <name>` (e2e uses Redis DB 9; never point a dev server at it)
   - lint one area: `node ../../node_modules/eslint/bin/eslint.js <paths> --max-warnings=0`
   - rebuild a shared package only if YOU changed it (`backend-shared`, `validation`: `tsc -p tsconfig.build.json`; `api-client`: `tsc -p tsconfig.json`), and only the backend agent edits those.
5. **Only kill processes you started, by the PID you recorded.** Other sessions use this machine and the shared dev Postgres (`localhost:5433`) and Redis. Never delete rows you did not create. Test fixtures must clean up after themselves.
6. **Source files use CRLF line endings.** Use the Edit tool, or normalise `\r\n` before multi-line script edits (a scripted multi-line replace silently misses otherwise). Long heredocs with apostrophes break the shell wrapper: write script files with the Write tool.
7. **TDD:** write the failing test, watch it fail for the right reason, make it pass. Report exact commands and results. A claim without a command you ran is not a result.
8. Match the surrounding code's comment density and naming. UI copy says "business" and "branch"; code keeps `Shop` and `Branch`.

## Shared contract

Already in `packages/api-client` (committed by the coordinator before you start):

- `shopOrders.list(shopId, branchId?)`, `listPage(shopId, { …, branchId? })`, `search(shopId, { …, branchId? })`
- `printers.list(shopId, branchId?)`, `listPage(shopId, { …, branchId? })`
- `printers.issuePairingCode(shopId, branchId?)` returning `PairingCode { code, expiresAt, branchId?, branchName? }`
- `printers.moveBranch(printerId, branchId)` → `PUT /v1/shop/printers/:id/branch { branchId }` returning the printers that moved
- `ShopOrderResponse` and `PrinterResponse` carry `branchId?`, `branchName?` (optional only so old fixtures compile; **the API always sends both**)
- `MyShopMembership.branchId`, `.branchName`; `client.branches.*`; `ShopStaff` calls (step 2)

Server behaviour the frontend relies on (the backend agent implements exactly this):

- **`branchId` query on lists** (orders grouped/page/search, printers, print-job lists): narrows to that branch. A branch-bound caller is pinned to their own branch (omitted means their own; naming another is 403). Reuse `resolveBranchScope` (`services/api/src/shop-staff/branch-scope.ts`).
- **Reading or acting on one thing** (order, print job, printer, agent pairing) belonging to another branch: **403** for a branch-bound caller, with no side effect. All-branches callers are unaffected.
- **Responses** for orders, print jobs, printers and pairing codes include `branchId` and `branchName`.
- **Pairing code:** `POST /v1/shop/agents/pairing-code { shopId, branchId? }`. Branch resolution is the same as staff invites: branch-bound → their own (naming another is 403); otherwise the named branch, or the business's only branch, or 400 `BRANCH_REQUIRED`. A named branch must belong to the business and not be archived (400 `BRANCH_NOT_FOUND`, 409 `BRANCH_ARCHIVED`). The paired agent and every printer its heartbeat reports belong to that branch.
- **Move a PC:** `PUT /v1/shop/printers/:id/branch { branchId }` moves the printer's agent and all printers on it. Needs `MANAGE_SETTINGS` (owner). 409 `AGENT_HAS_ACTIVE_JOBS` if any of those printers has a queued or printing job. 400/409 `BRANCH_NOT_FOUND` / `BRANCH_ARCHIVED` as above.
- **Counter orders** (`POST /v1/shop/orders`): body gains optional `branchId`, resolved like the pairing code.
- **Customer orders** (`POST /v1/public/shops/:shopId/orders` and `POST /v1/orders`): body gains optional `branchId`. **Omitted → the business's oldest non-archived branch** (so QR codes already printed keep working). A branch that is archived or closed (`isOpen = false`) refuses the order: 409 `BRANCH_CLOSED` / `BRANCH_ARCHIVED`; a branch of another business: 400 `BRANCH_NOT_FOUND`. The business-level status stays the master gate: the order is accepted only if the business accepts orders today **and** the branch is open.
- **New public endpoint** `GET /v1/public/shops/:shopId/branches/:branchId` → `{ id, name, city, address, isOpen }` (no auth, rate-limited like the other public routes) for the customer QR page. 404 for an unknown or archived branch.
- **Error codes** the UI will give wording to: `BRANCH_CLOSED`, `BRANCH_ARCHIVED`, `BRANCH_NOT_FOUND`, `BRANCH_REQUIRED`, `AGENT_HAS_ACTIVE_JOBS` (the first four already have copy for the Branches page; the frontend adds `BRANCH_CLOSED` and `AGENT_HAS_ACTIVE_JOBS`).

## Backend track (`backend` agent)

Files: `services/api`, `services/worker`, `packages/backend-shared`, `packages/validation`, `packages/types`, `packages/api-client` (only to match the contract). Never `apps/*`.

### B1: Schema and migration

- [ ] Hand-write `services/api/prisma/migrations/20261018100000_branch_operations/migration.sql`, then `prisma migrate deploy` and `prisma generate` (a final-rename EPERM is harmless), verify with `prisma migrate status` and the drift check `prisma migrate diff --from-url <dev url> --to-schema-datamodel prisma/schema.prisma` (the only expected leftover drift is `pricing_rules.price_bands` from another session's unfinished work; leave it).
- [ ] Add `branch_id` to `orders`, `print_jobs`, `printers`, `printer_agents`, `agent_pairing_codes`: backfill every row with its business's branch (the business has exactly one branch today: `SELECT id FROM branches WHERE shop_id = …` oldest), then `NOT NULL`, composite FK `(branch_id, shop_id) → branches(id, shop_id)` (NO ACTION), and an index suited to the filtered lists (e.g. `(shop_id, branch_id, order_status)` for orders).
- [ ] A `BEFORE INSERT` trigger on each of those tables that fills a NULL `branch_id` with the business's oldest non-archived branch (for `print_jobs`: the order's branch), so **older code on the shared dev database that does not know about branches keeps inserting**. New code must always set `branchId` explicitly; the trigger is a safety net, not a code path. Tests prove explicitness by creating everything at a **second** branch and asserting nothing lands in the first.
- [ ] `staff_notifications.branch_id` nullable (null = business-wide, which is what every existing row means).
- [ ] Update `schema.prisma` to match exactly (no new drift). Additive only.

### B2: Branch scope enforcement

- [ ] Resolve a resource's branch alongside its shop for orders, print jobs, printers and agent pairing, and have the shop-scope check refuse a branch-bound member whose branch differs (403), without changing the existing shop checks. Prefer extending the existing `ShopResourceResolver` / `ShopScopeGuard` pattern over ad-hoc checks per route. `ShopMembershipService.getAccess` already returns the member's `branchId`.
- [ ] Add the `branchId` list filter with `resolveBranchScope` to: orders grouped list, page, search; printers list/page; print-job lists. Raw SQL and `ShopScopedRepository` queries must gain the same predicate.
- [ ] e2e: a branch-bound manager gets 403 on **every** route that takes another branch's order / print job / printer id (reads and writes), lists only their branch, and an all-branches person sees all and can filter. Cover a resource by id, a list, a write, and a search.

### B3: Where orders are created

- [ ] Counter orders, authenticated customer orders and public QR orders store `branchId` on the order (and copy it to its print jobs, as `shopId` is copied today), resolved and validated per the contract (open, not archived, own business).
- [ ] The public branch endpoint from the contract.
- [ ] e2e: an order placed through branch B's QR lands in B (and its jobs in B); an old QR with no branch lands in the oldest branch; a closed branch refuses (409 `BRANCH_CLOSED`) while another branch of the same business still accepts; a closed _business_ refuses every branch.

### B4: Allocation, recovery and failover per branch (the physical-mistake risk)

- [ ] `buildPrinterCandidates(tx, shopId)` (`packages/backend-shared/src/print-jobs/printer-candidates.ts`) takes the job's branch; a job only considers printers of its own branch. Every caller changes: accepting an order, counter orders, `reallocate-waiting-jobs`, `reevaluate-printer-jobs`, manual reassignment (the chosen printer must be in the job's branch, else 409/403 with a clear code), `print-jobs.service`, and the worker's printer-offline failover (`services/worker/src/printer-offline-sweep`).
- [ ] **Paper stays business-wide** (step 4): pass the same shop id to the paper checks as today.
- [ ] e2e (these are the tests that matter most): with printers at branches A and B, a job at A is never allocated to B's printer even when A's is offline or at its page limit (it blocks with the existing explicit reason instead); failover and queue recovery stay inside the branch; manual reassignment to the other branch's printer is refused.

### B5: Agents, pairing and moving a PC

- [ ] Pairing-code issue/redeem, agent registration, and the heartbeat's auto-created printers use the branch per the contract. **The heartbeat must match printers by `{ shopId, branchId (the agent's), name }`**, not `{ shopId, name }`, or two branches' printers with the same Windows name would merge into one row.
- [ ] Manual `POST /v1/shop/printers` takes an optional `branchId`, resolved like the pairing code.
- [ ] `PUT /v1/shop/printers/:id/branch` per the contract, with row locks so a job cannot be queued while the PC moves. Audit it.
- [ ] e2e: pairing for branch B yields an agent and printers in B; same-named printers at two branches stay separate; a move is refused with a queued job and succeeds without; a branch-bound manager cannot pair for or move to another branch; only `MANAGE_SETTINGS` can move.
- [ ] The C++ agent needs **no** protocol change (the branch is known server-side from the agent row). Do not edit `apps/printer-agent-cpp`.

### B6: Alerts

- [ ] `StaffAlert` carries `branchId`; recipients are active members who hold the permission **and** either work at that branch or at all branches. The notification centre's read side applies the same rule (including the raw SQL in `notification-center.service.ts`). Job-blocked/failed alerts use the job's branch.
- [ ] e2e: an alert for branch A reaches A's staff and the owner, and not branch B's staff.

### Backend done-when

All of the above with the e2e listed; `tsc -p tsconfig.typecheck.json` clean for `services/api`; unit and e2e suites for everything you touched green, then the **whole** API e2e suite green (re-run any failing suite alone before blaming your change: a few unrelated timing-sensitive suites are flaky under load). Report the migration check (`migrate status`, drift diff, `\d printers` via `docker exec … psql`).

## Frontend track (`frontend` agent)

Files: `apps/shop-web`, `apps/customer-web`, `packages/design-tokens`. Never `services/*` or `packages/*` (except design-tokens). Code against the shared contract; the backend is being built at the same time, so verify with Playwright **route fixtures** (no live API needed).

### F1: Branch selection (pure logic, tested)

- [ ] `apps/shop-web/src/lib/branch-selection.ts` with tests: given the member's own `branchId`, the active branches, and a stored choice, decide the effective branch. A branch-bound person is fixed to their own branch (no choice). A business with one active branch is that branch (no choice). An all-branches person chooses one branch or "All branches" (null). A stored id that is archived or missing falls back to "All branches". Storage key per business, e.g. `pa.shop-web.branch.<shopId>`, wrapped in try/catch (storage can throw).

### F2: Session plumbing

- [ ] The session (`components/session-provider.tsx`) exposes `branches`, the effective `branch` (or null for all), and `selectBranch`, loaded with `getApi().branches.list(shopId)`; reset when the business changes. Update the test helper `components/test-session.ts` so existing tests compile.

### F3: The branch switcher

- [ ] A control in the shell next to the business switcher (`components/shell/business-switcher.tsx` and the phone navigation): "All branches" plus each branch. Shown **only** when the person has a real choice (more than one branch and not branch-bound). A branch-bound person sees their branch's name as a plain label; a one-branch business shows nothing new. Keyboard and screen-reader friendly, like the existing switcher.

### F4: Lists follow the selection

- [ ] Orders (queue, list, search) and Printers pass `branchId` (when a branch is selected) to the api-client calls, and refetch when the selection changes. When "All branches" is selected in a multi-branch business, show a **Branch** column (orders and printers tables, and the order detail header); with one branch selected or a one-branch business, no column.
- [ ] Add `BRANCH_CLOSED` and `AGENT_HAS_ACTIVE_JOBS` to `lib/error-copy.ts` (+ test).

### F5: Printers page: pairing and moving

- [ ] "Pair a computer" shows a branch choice when it matters (same rules as the staff invite dialog: nothing pre-chosen when there is a real choice; a branch-bound person's own branch; nothing for a one-branch business) and calls `issuePairingCode(shopId, branchId?)`; the dialog states which branch the code is for.
- [ ] Owners (`MANAGE_SETTINGS`): a "Move to another branch" action on a printer calls `moveBranch`; the confirmation says it moves the PC **and every printer on it**; the refusal for active jobs is shown in plain words.

### F6: Per-branch QR on the Branches page

- [ ] Each branch row can show/download its QR code and copy its link: `<customer-web origin>/s/<shopId>/upload?branch=<branchId>`. Reuse `components/admin/shop-qr-code.tsx` (extend it with an optional branch). The Settings page's single business QR is replaced by a short note and a link to the Branches page (old printed codes still work: they go to the oldest branch).

### F7: Customer QR page

- [ ] `apps/customer-web` `/s/[shopId]/upload`: read the `branch` query parameter, keep it through the order wizard, and send `branchId` in the order-create body. Show "Ordering from <branch name>" using `GET /v1/public/shops/:shopId/branches/:branchId` (cross-origin helper in `lib/public-api.ts`). A closed branch shows a friendly "this branch is closed right now" state and does not let the customer continue. A missing or unknown `branch` parameter is ignored (the server falls back to the oldest branch).

### Frontend done-when

Unit tests for every new pure module; `tsc --noEmit`, eslint (zero warnings) and the app's jest suite green for `shop-web` and `customer-web`; `next build` for each app that you changed (`node node_modules/next/dist/bin/next build` from the app folder; shop-web dev uses `.next-dev` so a build does not disturb a dev server, customer-web's dev server shares `.next`: build only if no dev server is running on its port, otherwise skip and say so). Then a **Playwright route-fixture check** of each changed surface with your own server:

- shop-web: start `next dev --port 3012` from `apps/shop-web` (PowerShell `Start-Process node -ArgumentList 'node_modules/next/dist/bin/next','dev','--port','3012' -PassThru`, record the PID, stop only that PID with `taskkill /PID <id> /T /F`). Playwright 1.63 is at `node_modules/.pnpm/playwright@1.63.0/node_modules/playwright`. Sign in by setting the cookie `shop_access_token` to any value (and `shop_theme` to `dark` or `light`); answer `context.route("**/api/**")` from fixtures: `/api/auth/session` → `{ user }`, `/api/v1/shop/staff/me` → `{ user, shops: [{ id, name, role, permissions, branchId, branchName }] }`, `/api/v1/notifications/unread-count`, `/api/v1/shop/branches`, and the screen's own endpoints; anything unanswered returns 404.
- customer-web: it calls the API cross-origin at `NEXT_PUBLIC_API_BASE_URL` (see `lib/public-api.ts`): route that origin in Playwright and answer OPTIONS with CORS headers. Use port 3013 and the same PID rule.
- Check at 1440px, 1100px and 390px for sideways overflow (`Math.max(document.documentElement.scrollWidth, innerWidth) - width`), in dark and light, and with: a two-branch business as owner; a one-branch business (no branch controls anywhere); a branch-bound manager (no switcher, own branch label).

## Reporting (both agents)

State: files changed, exact commands run with pass/fail, anything not verified and why, and any **contract gap** (a change needed outside your scope). The backend agent also reports the migration verification. Do not claim anything you did not run.

## Coordinator's checklist after both finish

- [ ] Read both reports; `git status` and `git diff --stat` for stray or out-of-scope edits.
- [ ] Run the repo-wide typecheck (`pnpm typecheck`, which includes spec files), lint, unit tests, and the whole API e2e suite once; wire any contract gap.
- [ ] One fresh whole-step review, then one fix pass with tests first; commit in logical commits (backend, client contract already committed, frontend); never push.
