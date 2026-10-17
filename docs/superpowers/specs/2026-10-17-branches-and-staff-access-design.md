# Branches and per-person staff access: design

Date: 2026-10-17
Status: approved by the product owner (2026-10-17). Part 1 (per-person access and the Edit button)
is implemented on branch `manager-permissions`; Part 2 (branches, steps 2-5) is not started.

## Purpose

Two requests from the product owner (2026-10-17), both made from the Staff page
(`/staff`, `apps/shop-web/src/components/staff/staff-screen.tsx`).

1. **Edit a person's access.** Today a person's access comes only from their role
   (`ROLE_PERMISSIONS`, `packages/backend-shared/src/auth/role-permissions.ts`). The owner
   wants to decide, per person, what someone can and cannot do. For example, a manager who
   handles orders and stock but cannot see reports. On each staff row, "Change role" stays,
   and "Remove" is replaced by **"Edit"**.
2. **Branches.** A business, like Amazon, has branches in several cities, or in several
   blocks of one city. All branches belong to one business. There is no admin at each
   branch; the person who works there is that branch's manager and manages that branch
   only. The owner sees and runs all of them.

Neither exists today. There is no per-person override anywhere, and there is no `Branch`
concept. `Shop` is the tenant (shown as "Business" in the UI), and the PRD lists
multi-branch as deferred (`docs/prd/print-automated-master-prd.md`), so this is new scope
that the product owner has now asked for.

## Decisions (agreed with the product owner)

- **Staff row buttons:** "Change role" and "Edit". "Edit" opens one panel with:
  - the person's **branch**;
  - their **access** (a tick list of permissions);
  - **Remove from business** at the bottom, so removing someone is still possible.
- **Access model:** each role keeps its default permissions, and the owner (or a manager)
  can switch individual permissions on or off for one person. The server enforces this,
  not just the screen.
- **Branches live inside one business.** A branch is not a separate business. Prices, the
  catalogue, suppliers, settings and billing are shared. Each branch has its own orders,
  printers, print jobs, paper stock, purchase orders and alerts.
- **Staff and branches:**
  - Every non-owner (manager, counter staff, operator, printer manager) belongs to
    exactly one branch and sees only that branch.
  - Owners always see all branches.
  - The owner may also mark a trusted non-owner, such as an area manager, as
    **"All branches"**.
- **Managers per branch:** a branch can have one manager or several. There is no hard
  limit.
- **Prices shared, stock separate.** One price list for the business. Each branch has its
  own paper stock, and its printers only use their own branch's paper.
- **One QR code per branch.** Scanning it sends the order to that branch. The customer
  never picks a branch.

## Goals

- An owner with three locations creates three branches, puts a manager and staff in each,
  and pairs each location's PC and printers to its own branch.
- A branch manager signs in and sees only their branch: its orders, queue, printers,
  stock, purchase orders, alerts, dashboard and reports, and only their branch's people
  on the Staff page.
- A job taken at branch A can only print on branch A's printers and only uses branch A's
  paper.
- The owner can view one branch at a time, or "All branches" together, everywhere in the
  console.
- The owner can tick or untick individual permissions for any non-owner.

## Non-goals

- Per-branch prices or catalogue. Prices stay business-wide.
- Moving stock between branches (stock transfers), or moving an order or job to another
  branch.
- A business-wide QR code with a branch picker.
- Per-branch billing. The business keeps one plan whatever its number of branches.
- A branch picker in shop-mobile beyond what the server already enforces (see "Left to
  the builder").
- Changing how separate businesses work. A person who works for two different businesses
  still uses the existing business switcher.

## Anti-goals (a failure even if everything else works)

- A branch-bound person can see or change **anything** belonging to another branch by
  guessing an id, editing a query string or calling the API directly. Branch checks are
  server-side and apply to reads, writes, lists, exports, dashboards, reports, the live
  dashboard stream and notifications.
- A job prints on another branch's printer, or uses another branch's paper.
- QR codes already printed and stuck on counters stop working.
- A business with one location notices anything other than a branch now existing, named
  after the business.
- Someone gives themselves, or anyone else, more access than they hold themselves.

## Part 1: per-person access and the "Edit" button

This part does not depend on branches and ships first.

### Data

On `ShopStaff`, add two text-array columns, both defaulting to empty:

- `extraPermissions`: granted on top of the role's defaults.
- `removedPermissions`: taken away from the role's defaults.

The effective permissions are `(ROLE_PERMISSIONS[role] ∪ extra) − removed`. For an owner
the result is always the owner's full set, and owner rows never store overrides.

Storing the difference rather than a full list means a later change to a role's defaults
in code still reaches everyone who was not customised on that permission.

### One function for effective access

Add `effectivePermissions(role, extra, removed)` to `packages/backend-shared/src/auth/`,
and extend `ShopMembershipService` (`services/api/src/auth/shop-membership.service.ts`)
with a method that returns `{ role, permissions, branchId }` for a member. Every place that
reads `ROLE_PERMISSIONS[...]` for a **member** must use it instead:

- `services/api/src/auth/permissions.guard.ts:47`
- `services/api/src/shop-staff/shop-staff.service.ts:92` (`/me`, so the web nav and pages
  follow automatically) and `:124`
- `services/api/src/deliveries/delivery-redaction.interceptor.ts:65`
- `services/api/src/shop-settings/shop-settings.service.ts:249`
- `services/api/src/shop-orders/shop-orders.service.ts:754`
- Staff alert fan-out: `packages/backend-shared/src/notifications/staff-notifications.ts`
  (`rolesWithPermission`, used by `notifyShopStaff`).
- Its read-side re-check in `services/api/src/notification-center/notification-center.service.ts`
  (around lines 175–208, raw SQL on `ss.role`). This must also respect the overrides,
  otherwise someone whose `VIEW_INVENTORY` was removed still gets low-stock alerts.

`ROLE_PERMISSIONS` stays as the table of role defaults.

### Rules (enforced by the API)

- Nobody edits their own access.
- An owner's access cannot be edited.
- The existing rank rules for "Change role" apply unchanged (`authorizeMutationLocked`,
  `role-rank.ts`). A manager cannot edit an owner.
- **No escalation, by any route.** Nobody can give anyone a permission they do not hold
  themselves. This covers the tick list, **Change role** and **invites**: a role change or
  invite whose role defaults include a permission the editor lacks is refused, and the
  error names that permission. Without this, a manager with a removed permission could
  promote a colleague to manager, and that colleague could switch it back on for them.
- **Role checks that duplicate a permission are widened.** Some routes gate on the role
  as well as the permission: the `@Roles(...)` lists on the print-jobs and `shop/agents`
  controllers. They are widened to every shop staff role, so the permission alone decides
  and a ticked permission really works.
- **Role checks that are about who someone is stay unchanged.** The assignee of a job
  must be an operator (`print-jobs.service.ts`, around line 308). Billing stays owner-only.
- **Any role can be given any permission except the owner-only ones**
  (`MANAGE_SETTINGS`, billing). A counter person given `MANAGE_USERS` can still only
  manage people of their own rank, because the rank rules still apply.
- `MANAGE_SETTINGS` (business details, billing) stays owner-only and cannot be granted to
  a non-owner.
- "Manage" implies "view". Ticking `MANAGE_INVENTORY` also ticks `VIEW_INVENTORY`, and
  `MANAGE_PRINTERS` ticks `VIEW_PRINTERS`. The server normalises this; the UI mirrors it.
- **Changing someone's role resets their custom access** to the new role's defaults. The
  Change role dialog says so when the person has custom access. (My call: carrying
  overrides across roles would give surprising results.)
- Every change is audited with a new `SHOP_STAFF_ACCESS_CHANGED` action that records
  before and after.

### API

- `PATCH /v1/shop/staff/:id` with body `{ permissions?: Permission[], branchId?: string | null }`.
  - `permissions` is the full desired list. The server stores it as the difference from
    the role's defaults.
  - `branchId` belongs to Part 2 and is added there.
  - Tenant check is the same as the existing `PATCH :id/role` (`ShopStaffShopResolver`),
    and it needs `MANAGE_USERS`.
- `GET /v1/shop/staff` returns, per member, `permissions` (effective), `customised: boolean`
  and, once Part 2 lands, `branchId` and `branchName`.
- Add the matching methods to `packages/api-client/src/resources/shop-staff.resource.ts`.

### UI (shop-web)

- The staff row keeps "Change role" and replaces "Remove" with "Edit".
- **Edit panel** (a `FormDialog` like the existing dialogs, or a side sheet if the
  console's redesign kit has one):
  - **Branch:** added in Part 2.
  - **Access:** permissions grouped under plain headings: Orders; Production and print
    jobs; Printers; Stock and suppliers; Catalogue and prices; Reports and dashboards;
    Staff; Settings.
    - Each line has a plain-English label, not the enum name.
    - Lines that differ from the role's default carry a small "custom" marker.
    - "Reset to role defaults" clears every override.
    - Permissions the editor cannot grant are shown disabled, with the reason.
  - **Remove from business:** a danger section at the bottom that opens the existing
    `RemoveDialog` flow.
- The roster shows a small "Custom access" pill on customised people.
- Permission labels and grouping go in a pure `lib/permission-groups.ts` with a sibling
  test, matching the repo's `lib/*-view.ts` pattern.

## Part 2: branches

### Data model

New `Branch` model (hand-written migration):

- Fields: `id`, `shopId`, `name`, `city`, `address`, `phone?`, `latitude?`, `longitude?`,
  `status` (the existing `ShopStatus` enum: OPEN or CLOSED), `openingHours Json?`,
  `archivedAt?`, `createdAt`, `updatedAt`.
- Constraints: `@@unique([shopId, name])`, and `@@unique([id, shopId])` so child tables can
  use composite foreign keys `(branch_id, shop_id) → branches(id, shop_id)`. This is the
  same database-level tenant guarantee the inventory, supplier and purchase-order tables
  already use.

Backfill and the default branch:

- **Backfill:** every existing shop gets one branch named after the shop. It copies the
  shop's address, phone, coordinates and opening hours, and is **open** (see "Opening
  state").
- **Shared dev database safety.** Other sessions run older code against the same
  database.
  - Each new `branch_id NOT NULL` column gets a `BEFORE INSERT` trigger that fills the
    business's oldest branch when an insert leaves it empty, so their inserts keep
    working.
  - This feature's code must always set `branchId` explicitly, and never rely on the
    trigger. The e2e tests prove this by creating everything at a **second** branch and
    asserting that nothing lands in the first.
  - The triggers can be dropped once every running copy of the code is branch-aware.
- Every location-scoped row is set to that branch, then the column becomes `NOT NULL`.
- **New businesses** get their first branch automatically, the same way
  `shops_create_settings_trg` creates settings today (a trigger, or the admin
  create-business path; builder's choice).

Location-scoped tables get `branchId`:

- **Get `branchId NOT NULL`:** `Order`, `PrintJob` (copied from its order, as `shopId` is
  today), `Printer`, `PrinterAgent`, `AgentPairingCode`, `InventoryItem`, `InventoryAlert`,
  `PurchaseOrder`, `PrinterAutomationRule`.
- **Gets `branchId` nullable:** `StaffNotification`.
- **Follow their parent with no column:** order items, payments, refunds, deliveries,
  reprints, inventory movements and purchase-order lines.
- **Stay business-wide:** `Product`, `PricingRule`, `Customer`, `Supplier`,
  `SupplierProduct`, `ShopSettings` (except opening hours, which move to the branch),
  `ShopPlan`, `PaymentProof`.
- **Inventory SKU:** the unique key changes from `[shopId, sku]` to `[branchId, sku]`, so
  every branch can stock the same SKU. `SupplierProduct` links to a supplier and an item,
  so the builder must decide whether it links per branch item or by SKU (see "Left to
  the builder").

Staff and invites:

- `ShopStaff.branchId String?` and `ShopStaffInvite.branchId String?`. Null means "All
  branches".
- Owners are always null.
- A non-owner must have a branch, unless an **owner** chose "All branches" for them.
- Backfill: existing non-owners go to the business's single branch.

### Who sees what

- **Branch-bound person** (`branchId` set): every read and write is limited to that branch.
  A branch query parameter naming another branch is refused with 403.
- **All-branches person** (owner, or a non-owner marked "All branches"): sees everything,
  and can narrow any screen to one branch.
- **Business-wide things are view-only for branch-bound people** (product owner's
  decision, 2026-10-17).
  - This covers prices and products, suppliers, and business settings, including the
    automation, failover, quality-check and stock-tracking switches.
  - Branch-bound people may **see** them if they hold the view permission. Changing them
    needs the permission **and** all-branches access (owner, or "All branches").
  - This is enforced in the API on every write route for these resources.
  - The UI hides edit controls for branch-bound people and says "Only the owner can
    change this, because it affects every branch".
  - In the Edit panel, these permissions show for a branch-bound person as "view only
    while assigned to a branch".
- **Customers are shared** (product owner's decision, 2026-10-17). Every branch sees the
  full customer list, so a regular customer can be found at any branch. A customer's
  orders still show only to the branch where each order was placed, plus all-branches
  people.
- **Staff page for a branch-bound manager:** they see and invite only their branch's
  people, cannot move anyone to another branch, and cannot grant "All branches". Only an
  owner can do either.

### Enforcement (server)

Shop scoping today has no single choke point. About 25 services write `where: { shopId }`
by hand, and dashboards and reports use raw SQL. So branch scoping is added in the same
places, with shared helpers to keep it uniform:

- **The member's branch:** the membership method from Part 1 returns it.
- **Routes with an `:id`:** the `ShopResourceResolver` interface
  (`services/api/src/auth/shop-scope.interfaces.ts`) returns `{ shopId, branchId }`.
  `ShopScopeGuard` then also denies a branch-bound member whose branch differs. There are
  12 resolvers to update.
- **List and create routes:** take an optional `branchId` (query or body). A shared helper
  turns `(member, requestedBranchId)` into a Prisma `where` fragment, or a SQL fragment
  for raw queries, or refuses with 403.
- **Raw SQL in reports and dashboards**
  (`services/api/src/reports/reports.service.ts`,
  `services/api/src/dashboard/dashboard.service.ts`) gets the same branch predicate.
- **The live dashboard stream:** events carry `branchId`, and branch-bound subscribers
  only receive their own branch's events.

### Printing, paper and agents

These are where a missing branch check causes physical mistakes, so they get their own
tests:

- **Printer allocation:** `buildPrinterCandidates(tx, shopId)`
  (`packages/backend-shared/src/print-jobs/printer-candidates.ts`) becomes per branch. A
  job only considers printers of the job's branch. The same applies to every caller:
  - accepting an order and counter orders;
  - manual reassignment, where `print-jobs.service.ts` checks the chosen printer with
    `{ id, shopId }` today;
  - `reallocate-waiting-jobs`, `reevaluate-printer-jobs`, and the worker's printer-offline
    failover.
- **Paper:** `paper-availability.ts` and `consume-paper.ts` read and consume the branch's
  stock only.
- **Agents:**
  - A pairing code is issued **for a branch**, from the Printers page, which needs a
    branch selected.
  - The agent row stores it.
  - Printers that the agent's heartbeat auto-creates get the agent's branch.
  - The heartbeat must match printers by agent and name, not by shop and name. Otherwise
    two branches' printers with the same Windows name would collapse into one row.
- **Moving a PC to another branch:**
  - The owner can move a paired agent, together with its printers, to another branch from
    the Printers page.
  - It is allowed only when none of its printers has a queued or printing job.
  - Page-usage history stays with each printer.
  - This also sorts out existing setups after the backfill, without visiting each PC to
    re-pair it.
- **The C++ agent:** needs no protocol change, because the branch is known server-side
  from the agent row. Its status window can show the branch name if the register or
  heartbeat response returns it (optional).

### Orders

- **Customer QR:** each branch's QR encodes the branch.
  - Proposed URL: `/s/[shopId]/upload?branch=<branchId>`. The builder may choose a path
    segment instead.
  - The public order endpoint takes the branch, checks that the branch is open and not
    archived, and stores it on the order.
  - **Old QR codes with no branch keep working.** They go to the business's first (oldest)
    branch.
- **Counter orders:**
  - A branch-bound person's orders are created in their branch.
  - An all-branches person creates them in the branch currently selected in the console.
    If "All branches" is selected, the form asks which branch.
- **Opening state:**
  - A branch has its own simple **open/closed** switch, and it **defaults to open**.
  - The existing business-level `Shop.status` (all five values, set by the platform
    admin) stays the master gate. An order is accepted only when the business accepts
    orders today **and** the branch is open. A one-location business therefore behaves
    exactly as now.
  - The owner and that branch's managers can open or close a branch. Only the owner edits
    its details.
  - Opening hours are stored per branch and **shown only, not enforced**. That matches
    today, where nothing enforces hours, and adds no new refusal behaviour.

### Inventory and purchasing

- Inventory items, movements, alerts and purchase orders are per branch.
- A purchase order is raised for one branch and received into that branch's stock.
- The low-stock sweep (`packages/backend-shared/src/inventory/low-stock-alerts.ts`) raises
  each alert with its branch.
- **A new branch** gets a copy of the business's stock item list, each item at zero.
  - The owner or manager enters the starting stock.
  - Until they do, a business with stock tracking on will block that branch's jobs with
    the existing "not enough paper" reason. That is correct, because no paper is recorded
    there.
  - The Branches page and the branch's Inventory screen show a "starting stock not
    entered yet" warning.
  - Stock tracking stays one business-wide switch.

### Notifications

- A staff alert (`StaffAlert`) carries `branchId`.
- Recipients are active members who hold the permission (effective, per Part 1) **and**
  either belong to that branch or have all-branches access.
- The notification centre's read side applies the same rule.

### UI (shop-web)

- **Branches page:** a new item in the sidebar's Business section, owner only, gated on
  `MANAGE_SETTINGS`.
  - **The list:** one row per branch with name, city, open or closed, its managers, and
    staff and printer counts.
  - **Add or edit a branch:** name, city, address, phone and opening hours.
  - **Open or close a branch.**
  - **Archive a branch:** only allowed when it has no active staff, no paired agents and
    no unfinished orders.
  - **Download the branch's QR code:** reuse `components/admin/shop-qr-code.tsx`, which
    today is shown in Settings and the admin business detail.
- **Branch switcher** for all-branches people:
  - It sits next to the existing business switcher
    (`components/shell/business-switcher.tsx`) and lists "All branches" plus each branch.
  - The choice is remembered in localStorage, the same way the business choice is.
  - Every business screen passes the selected branch to its API calls.
  - Branch-bound people see their branch's name as a label with no switcher.
- **Staff page:**
  - A Branch column and a Branch filter.
  - The invite dialog gets a Branch field. It is required for non-owner roles; "All
    branches" is offered only to an owner.
  - The Edit panel's Branch field: changing it is audited (`SHOP_STAFF_BRANCH_CHANGED`).
- **When "All branches" is selected:** orders, printers, inventory, purchase orders,
  dashboard and reports show a Branch column or filter. The owner's dashboard and reports
  add a per-branch breakdown.
- **Settings:** the single QR code moves to the Branches page (one per branch). Opening
  hours move to the branch.

### shop-mobile

The server enforces branch scope, so a branch-bound person on the phone already sees only
their branch with no app change.

For all-branches people, the minimum is that the app shows all branches. Adding a branch
picker is left to the builder.

## Delivery order

Each step ships and is verified end to end before the next, with one commit per step (the
repo's working agreement):

1. **Per-person access and the Edit button.** All of Part 1. It is useful on its own and
   independent of branches.
2. **Branch foundation:**
   - the `Branch` model and backfill, and the Branches page;
   - staff branch assignment (Edit panel, invite), `/me` returning the branch, and the
     branch switcher;
   - staff-page scoping for branch-bound managers.

   Data is not yet split by branch at this step, so it is not released to real
   multi-branch users until step 3.

3. **Branch-scoped operations:**
   - orders, print jobs, printers, agents and pairing, allocation, paper, deliveries;
   - notifications and the live dashboard stream;
   - the per-branch QR code and branch-aware counter orders.
4. **Branch-scoped stock and purchasing:** inventory items and SKUs per branch, purchase
   orders, low-stock alerts, and supplier-product links.
5. **Dashboards and reports by branch:** the branch filter and the owner's per-branch
   breakdown.

Work happens on a new git branch cut from `redesign/shop-web-console`, because it builds
on the redesigned console. That branch stays untouched until this is merged.

## Constraints

- **Migrations:** hand-written migrations, then `prisma migrate deploy`. Never
  `migrate reset`, and never use the dev database as a shadow database (CLAUDE.md).
  Backfills must be additive and safe on the shared dev database, which other sessions use
  live.
- **State machines:** they stay the only writers of status columns. Adding `branchId` to
  orders and jobs does not change that.
- **Tests:**
  - e2e runs on Redis DB 9, with jest launched directly under `timeout`.
  - Every branch check needs an e2e test proving a branch-bound person is refused on the
    other branch. Cover a resource by id, a list, a write, a report and an alert. Model
    these on `services/api/test/shop-staff-management.e2e-spec.ts` and the authorization
    matrix specs.
  - Every per-person access rule (no escalation, owner untouchable, reset on role change,
    manage implies view, `MANAGE_SETTINGS` not grantable) gets an e2e test.
- **UI checks:** shop-web UI is checked with the Playwright route-fixture setup
  (`reference_shop_web_browser_check` in the project memory), because jest has no DOM.

## Left to the builder

- Dialog versus side sheet for the Edit panel.
- The exact permission labels and grouping.
- Whether the first branch for a new business is created by a trigger or in the admin
  create-business service.
- Whether `SupplierProduct` links to a branch's item or to a SKU shared across branches.
- The QR URL shape (query string or path segment), provided old codes keep working.
- Whether the C++ agent shows its branch name.
- A shop-mobile branch picker for all-branches people.
- How the request-scoped membership lookup is cached, so the guards and services do not
  query it repeatedly.

## My calls (the product owner may override)

- Changing a role resets custom access.
- `MANAGE_SETTINGS` can never be granted to a non-owner.
- Old QR codes without a branch go to the business's oldest branch.
- Business-level `Shop.status` remains a master switch over every branch.
- An archived branch keeps its history (orders and reports) but accepts nothing new.
- Billing stays one plan per business.
- Only owners manage branches (create, edit, archive) and grant "All branches".
- No escalation through Change role or invites, not only through the tick list.
- A branch defaults to open. Opening hours are shown, not enforced.
- Shared dev database: insert triggers fill the default branch for older code. New code
  always sets it explicitly.
- A new branch gets the business's item list at zero stock.
- The owner can move a paired PC (agent) and its printers to another branch when they
  have no active jobs.
