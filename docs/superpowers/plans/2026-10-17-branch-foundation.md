# Branch foundation (step 2): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business can have several branches, every non-owner staff member belongs to one branch (or is marked "All branches" by an owner), and the owner can manage branches and assign people to them from the console.

**Architecture:** A new `branches` table under `shops`. `shop_staff.branch_id` and `shop_staff_invites.branch_id` (nullable; null means "All branches") carry the assignment. `ShopMembershipService.getAccess` returns the member's branch, and `authorizeMutationLocked` enforces that a branch-bound actor only touches people of their own branch. Orders, printers, stock and reports are NOT split yet (steps 3 to 5), so this step is not released to a real multi-branch business before step 3.

**Tech Stack:** NestJS 11, Prisma 6 / Postgres, Zod (`packages/validation`), Jest, Next.js 15 (shop-web), `packages/api-client`.

**Spec:** `docs/superpowers/specs/2026-10-17-branches-and-staff-access-design.md`, Part 2, "Data model" (Branch, staff and invites), "Who sees what", the staff-page parts of "UI", and delivery step 2. Step 1 (`2026-10-17-staff-access-edit.md`) is already built on this branch.

## Global Constraints

- Work on branch `manager-permissions`. Commit locally with `git commit -a` (run `git add -N` on new files first). **Never push.** Leave the untracked `CLAUDE.md` out.
- Migrations are hand-written in `services/api/prisma/migrations/<timestamp>_<name>/migration.sql`, then `prisma migrate deploy` and `prisma generate` (a final-rename EPERM is harmless). Never `migrate reset`, never use the dev database as a shadow database. The dev database is shared with other sessions running older code: every change must be additive, and older code that inserts shops or staff must keep working.
- e2e: `cd services/api && timeout 300 node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand <name>`. Never through pnpm or cmd wrappers. Rebuild `backend-shared`, `validation` and `api-client` (`tsc -p tsconfig.build.json` / `tsconfig.json`) after editing them.
- Source files use CRLF: use the Edit tool, or normalise `\r\n` first in scripts. Look at the outcome of multi-line scripts.
- Branch fields: `name`, `city?`, `address`, `phone?`, `isOpen` (default true), `openingHours?` (shown only, never enforced), `archivedAt?`. `@@unique([shopId, name])` and `@@unique([id, shopId])`.
- Every existing shop gets exactly one branch, named after the shop and copying its address, phone, coordinates and opening hours, and is **open**. Every new shop gets one automatically (database trigger, like `shops_create_settings_trg`).
- Staff: `branchId` null means "All branches". Owners are always null. Backfill: existing non-owners (and their pending invites) go to their shop's branch.
- Assigning a branch to a non-owner: a given `branchId` must belong to the shop and not be archived; `null` ("All branches") may only be set by an owner; when omitted, the business's only non-archived branch is used, and with several branches the request is refused with 400 `BRANCH_REQUIRED`.
- A branch-bound actor (their own `branchId` is not null) only sees and touches people of their own branch, cannot move anyone to another branch, and cannot grant "All branches". Only an owner creates, edits or archives branches. A branch's own manager (or an owner) can open or close it.
- Archiving a branch is refused (409 `BRANCH_HAS_STAFF`) while it has active or suspended staff. (Orders, agents and stock arrive in later steps and add their own checks.)
- Business-wide things (prices, suppliers, settings, customers) are untouched in this step.
- Audit: `BRANCH_CREATED`, `BRANCH_UPDATED`, `BRANCH_OPEN_STATE_CHANGED`, `BRANCH_ARCHIVED`, `SHOP_STAFF_BRANCH_CHANGED`.

## Review Focus

- A branch-bound manager reaching another branch's person by id: edit access, change role, remove, move branch (all must be 403 with no side effect).
- A branch-bound manager inviting or adding someone into another branch, or as "All branches", or as an owner.
- Demoting an owner to a non-owner keeps "All branches" (only an owner can do it); promoting anyone to owner clears their branch.
- An invitation whose branch was archived before it is accepted must not land.
- Older code on the shared dev database inserts shops and non-owner staff with no branch: the shop still gets its branch, the staff row means "All branches" (same as before for a single-branch business).

---

## File structure

- Create migration `services/api/prisma/migrations/20261017180000_branches/migration.sql`; modify `services/api/prisma/schema.prisma` (`Branch`, `ShopStaff.branchId`, `ShopStaffInvite.branchId`, `Shop.branches`).
- Create `services/api/src/branches/`: `branches.module.ts`, `branches.controller.ts`, `branches.service.ts`, `branch-shop.resolver.ts`, `dto/*.dto.ts`, `branches.service.spec.ts` only if a pure helper warrants one.
- Modify `services/api/src/app.module.ts` (register the module), `auth/shop-membership.service.ts` (`getAccess` returns `branchId`), `shop-staff/shop-staff.service.ts`, `shop-staff.controller.ts`, `shop-staff-invites.service.ts`, `audit/audit-action.ts`.
- Modify `packages/validation/src/shop-staff/*`, create `packages/validation/src/branches/*`; modify `packages/api-client` (new `branches` resource, staff fields).
- shop-web: create `src/app/(console)/branches/page.tsx`, `src/components/branches/branches-screen.tsx`, `src/lib/branch-view.ts` (+ `.test.ts`); modify `src/lib/nav.ts`, `components/staff/staff-screen.tsx`, `edit-dialog.tsx`.
- Tests: `services/api/test/branches.e2e-spec.ts`, `services/api/test/staff-branches.e2e-spec.ts`.

---

### Task 1: Schema, migration, backfill, trigger

**Files:** `schema.prisma`, the migration above, `test/branches.e2e-spec.ts`.

**Interfaces:**

- Produces: Prisma `Branch { id, shopId, name, city?, address, phone?, latitude?, longitude?, isOpen, openingHours?, archivedAt?, createdAt, updatedAt }` mapped to `branches`; `ShopStaff.branchId String?` and `ShopStaffInvite.branchId String?` with composite foreign keys `(branch_id, shop_id) → branches(id, shop_id)` (MATCH SIMPLE, so null passes).

- [ ] **Step 1: Write the failing e2e** (`branches.e2e-spec.ts`, first describe "schema"): creating a shop with plain `prisma.shop.create` yields exactly one `branch` named after the shop, with the shop's address and `isOpen: true`; a shop that existed before the migration (any seeded shop) has exactly one branch; a `shopStaff` row cannot point at a branch of another shop (foreign key violation).
- [ ] **Step 2: Run it and see it fail** (no `branch` model).
- [ ] **Step 3: Write the migration and update the schema.** The migration creates the table, indexes and constraints; backfills one branch per shop; adds the two nullable columns with composite FKs; backfills non-owner staff and their pending invites to their shop's branch; creates `shops_create_first_branch()` and `shops_create_first_branch_trg` (AFTER INSERT on shops). Apply with `prisma migrate deploy` and `prisma generate`; verify with `prisma migrate status` and `\d branches` through `docker exec ... psql`.
- [ ] **Step 4: Run it and see it pass**, then the staff and shop e2e (`shop-staff-management`, `admin`) to prove older code still works.
- [ ] **Step 5: Commit.**

### Task 2: Branches API

**Files:** the `branches/` module, `app.module.ts`, `audit-action.ts`, `test/branches.e2e-spec.ts`.

**Interfaces:**

- Consumes: Task 1's model; `ShopMembershipService.getAccess` (from step 1).
- Produces:
  - `BranchResponse { id, shopId, name, city: string | null, address, phone: string | null, isOpen, openingHours: unknown | null, archivedAt: string | null, createdAt, staffCount: number, managers: Array<{ membershipId: string; userId: string; name: string }> }`.
  - `GET /v1/shop/branches?shopId&includeArchived=` (`VIEW_STAFF_DIRECTORY`): all-branches people see every branch, a branch-bound person sees only their own.
  - `POST /v1/shop/branches` `{ shopId, name, city?, address, phone? }` (`MANAGE_SETTINGS`).
  - `PATCH /v1/shop/branches/:id` `{ name?, city?, address?, phone?, openingHours? }` (`MANAGE_SETTINGS`).
  - `PUT /v1/shop/branches/:id/open-state` `{ isOpen: boolean }` (`MANAGE_USERS`; the service additionally requires `MANAGE_SETTINGS`, or being a SHOP_MANAGER bound to that branch).
  - `POST /v1/shop/branches/:id/archive` (`MANAGE_SETTINGS`): 409 `BRANCH_HAS_STAFF` while it has active or suspended staff; archiving the business's only non-archived branch is refused with 409 `LAST_BRANCH`.
  - `BranchShopResolver` implementing `ShopResourceResolver` (branch id → shop id).

- [ ] **Step 1: Write the failing e2e**, one `it` each: owner creates, lists, edits and archives a branch; duplicate name in a shop is 409; a counter or manager gets 403 on create/edit/archive; a manager bound to branch A can close branch A but not branch B (403), and the owner can close either; a branch-bound person lists only their own branch; archive is refused with staff in it and with the last branch; another business's owner gets 403; each mutation writes its audit row.
- [ ] **Step 2: Run and see them fail** (404, no routes).
- [ ] **Step 3: Implement** the module following `shop-staff`'s guards pattern (`JwtAuthGuard, RolesGuard, PermissionsGuard`, `@ShopScopedField` for list/create, `ShopScopeGuard` with `BranchShopResolver` for `:id` routes).
- [ ] **Step 4: Run and see them pass**, plus the e2e from Task 1.
- [ ] **Step 5: Commit.**

### Task 3: Membership branch awareness and the scoped roster

**Files:** `shop-membership.service.ts`, `shop-staff.service.ts` (`myShops`, `listStaff`), `shop-staff-invites.service.ts` (`listPending`), `test/staff-branches.e2e-spec.ts`.

**Interfaces:**

- Consumes: Task 1 and Task 2.
- Produces:
  - `MemberAccess` gains `branchId: string | null`.
  - `/me` memberships gain `branchId: string | null` and `branchName: string | null`.
  - Roster items and invite items gain `branchId: string | null` and `branchName: string | null`.
  - `GET /v1/shop/staff` and `/invites` accept `branchId` as a filter. A branch-bound caller always gets only their own branch (a different `branchId` is 403).

- [ ] **Step 1: Write the failing e2e** (`staff-branches.e2e-spec.ts`): `/me` shows a member's branch id and name; a branch-bound manager's roster lists only their branch's people (not the other branch's, nor all-branches people); an all-branches caller can filter by branch; a branch-bound caller asking for another branch is 403; the same for the pending invitations list.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass**, plus the step-1 staff suites (`shop-staff-access`, `shop-staff-management`, `shop-staff-invites`).
- [ ] **Step 5: Commit.**

### Task 4: Assigning and moving people

**Files:** `shop-staff.service.ts` (`addStaff`, `addStaffWithin`, `changeRole`, `updateAccess`, `authorizeMutationLocked`), `shop-staff-invites.service.ts` (`inviteByEmail`, `writeInvite`, `acceptInvite`, `revoke`), `shop-staff.controller.ts`, DTOs and validation schemas, `audit-action.ts`.

**Interfaces:**

- Consumes: Tasks 1 to 3.
- Produces:
  - `addShopStaffSchema` gains `branchId: z.string().uuid().nullable().optional()`.
  - `updateShopStaffAccessSchema` becomes `{ permissions?: Permission[]; branchId?: string | null }` with at least one present.
  - `authorizeMutationLocked` also reads each locked row's `branch_id`. A branch-bound actor is refused (403 "That person belongs to another branch.") when the target's branch differs from theirs, including all-branches people.
  - `resolveBranchForGrant(tx, { shopId, actor, role, branchId }): Promise<string | null>` as a private helper applying the Global Constraints rules.
  - `addStaffWithin` input gains `branchId?: string | null`; re-adding an active same-role member with `branchId` omitted keeps their branch.

- [ ] **Step 1: Write the failing e2e**, one `it` each: owner invites a counter into branch B and the accepted member lands in B; invite with no branch in a one-branch business uses that branch, and with two branches is 400 `BRANCH_REQUIRED`; only an owner can send `branchId: null` (a manager gets 403); a manager bound to A cannot invite into B, add into B, edit, change the role of, remove or move a person of B (all 403, row unchanged); a manager bound to A can invite into A; the owner moves a counter from A to B through `PATCH /v1/shop/staff/:id { branchId }` with `SHOP_STAFF_BRANCH_CHANGED` audited (before and after); an owner's branch is always null (inviting or promoting to owner clears it; demoting an owner leaves "All branches"); an invitation into a branch archived before acceptance does not land (404).
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** as in Interfaces. The branch check and the archive check run under the same row locks as the rank rules.
- [ ] **Step 4: Run and see them pass**, plus `shop-staff-*`, `authorization-matrix(-v2)`.
- [ ] **Step 5: Commit.**

### Task 5: Client packages

**Files:** `packages/validation/src/branches/branch.schema.ts` (+ index exports), `packages/api-client/src/resources/branches.resource.ts`, `packages/api-client/src/client.ts` and `index.ts`, `shop-staff.resource.ts`, `types.ts`.

**Interfaces:**

- Consumes: Tasks 2 to 4.
- Produces: `client.branches.{ list(shopId, {includeArchived?}), create(shopId, input), update(id, input), setOpen(id, isOpen), archive(id) }`; `BranchSummary` type (mirrors `BranchResponse`); `ShopStaff.addByEmail(shopId, email, role, branchId?)`; `updateAccess(id, { permissions?, branchId? })` (the old `(id, permissions[])` signature is replaced and its callers updated); `ShopStaffListItem`, `StaffInvite` and `MyShopMembership` gain the branch fields.

- [ ] **Step 1: Write the failing client tests** (`branches.resource.test.ts`, same harness as `shop-staff.resource.test.ts`): each method's HTTP method, URL and body.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement and rebuild** `validation` and `api-client`.
- [ ] **Step 4: Run** `api-client` tests and typecheck; **Step 5: Commit.**

### Task 6: Branches page

**Files:** `apps/shop-web/src/lib/branch-view.ts` (+ `.test.ts`), `apps/shop-web/src/lib/nav.ts`, `apps/shop-web/src/app/(console)/branches/page.tsx`, `apps/shop-web/src/components/branches/branches-screen.tsx`.

**Interfaces:**

- Consumes: Task 5's `client.branches`.
- Produces: `branchStatus(branch): "open" | "closed" | "archived"`; `canOpenClose(actor: { permissions: ReadonlySet<Permission>; role: UserRole | null; branchId: string | null }, branch: { id: string }): boolean`; `validateBranchForm({ name, address }): { name?: string; address?: string }` (name 1 to 80 characters, address required). Sidebar item "Branches" (group "business", `anyOf: [MANAGE_SETTINGS]`, `href: "/branches"`).

- [ ] **Step 1: Write the failing test** `branch-view.test.ts` covering the three functions above, including: a manager bound to branch A may open/close A but not B; an owner may open/close any; archived is never openable.
- [ ] **Step 2: Run and see it fail.** `pnpm --filter @print-automated/shop-web test -- branch-view`.
- [ ] **Step 3: Implement the lib module, the nav item, the page and the screen:** a table (Name, City, Address, Managers, People, Status, actions Edit, Open or Close, Archive), an add or edit dialog (name, city, address, phone) and an archive confirmation that shows the server's reason (`BRANCH_HAS_STAFF`, `LAST_BRANCH`).
- [ ] **Step 4: Verify** with lint, typecheck, tests and a Playwright route-fixture check (as for step 1): add, edit, close, archive refusal message.
- [ ] **Step 5: Commit.**

### Task 7: Branch on the Staff page

**Files:** `apps/shop-web/src/components/staff/staff-screen.tsx`, `edit-dialog.tsx`, `apps/shop-web/src/lib/staff-view.ts` (+ `.test.ts`).

**Interfaces:**

- Consumes: Task 5; `useSession().business.branchId`.
- Produces: `branchOptions(actor: { role: UserRole | null; branchId: string | null }, branches: BranchSummary[], opts: { forRole: string }): Array<{ value: string; label: string }>`: a branch-bound actor is offered only their own branch; "All branches" (value `""`) is offered only to an owner and never for the owner role; archived branches never appear.

- [ ] **Step 1: Write the failing test** for `branchOptions` in `staff-view.test.ts`: manager bound to A gets only A; owner gets all active branches plus "All branches" for a non-owner role and nothing for the owner role.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.** Roster gets a Branch column and a Branch filter. The invite dialog gets a Branch field (required for non-owner roles). The Edit panel gets a Branch field above the access list; Save sends only what changed.
- [ ] **Step 4: Verify** with lint, typecheck, tests, and the Playwright check: Branch column, filter, invite with a branch, move a person.
- [ ] **Step 5: Commit.**

### Task 8: Whole-feature verification

- [ ] **Step 1:** `pnpm typecheck`, `pnpm lint`, `pnpm test` from the repo root. Expected: green (the known `password.service.spec` timeout passes alone).
- [ ] **Step 2:** The whole API e2e suite. Re-run any failing suite alone before blaming the change.
- [ ] **Step 3:** Update the spec status line; update memory.
- [ ] **Step 4:** One fresh whole-branch review of this step's commits, then one fix pass with tests first.
