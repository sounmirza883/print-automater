# Per-person staff access and the "Edit" button: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner or manager tick individual permissions on or off for one staff member, from a new "Edit" button on the Staff page, enforced by the API.

**Architecture:** Each `ShopStaff` row stores the difference from its role's defaults in two text-array columns. One pure function (`effectivePermissions`) turns role plus overrides into the person's permissions. Every server place that read `ROLE_PERMISSIONS[role]` for a member now reads that function's result through `ShopMembershipService`.

**Tech Stack:** NestJS 11, Prisma 6 / Postgres, Zod (`packages/validation`), Jest, Next.js 15 (shop-web), `packages/api-client`.

**Spec:** `docs/superpowers/specs/2026-10-17-branches-and-staff-access-design.md`, "Part 1" only. Branches (Part 2) are a separate plan.

## Global Constraints

- Branch is `manager-permissions`. Commit locally only; **never push**.
- Migrations are hand-written in `services/api/prisma/migrations/<timestamp>_<name>/migration.sql`, then `prisma migrate deploy` and `prisma generate`. Never `migrate reset`; never use the dev database as a shadow database. The dev database is shared with other sessions, so the migration must be additive.
- e2e: `cd services/api && timeout 300 node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.cjs --runInBand <name>`. Never launch through pnpm or cmd wrappers.
- Workspace packages are consumed from `dist`: rebuild `backend-shared`, `validation` and `api-client` after editing them, before running anything that depends on them.
- Effective permissions = `(ROLE_PERMISSIONS[role] ∪ extra) − removed`. Owners always get the full owner set; owner rows never store overrides.
- Nobody edits their own access. An owner's access cannot be edited.
- No escalation by any route (tick list, Change role, invites): nothing may be granted that the actor does not hold.
- `MANAGE_SETTINGS` can never be granted to a non-owner.
- Manage implies view: server normalises, UI mirrors.
- Changing a role resets the person's custom access.
- Every access change is audited as `SHOP_STAFF_ACCESS_CHANGED` with before and after.
- Row buttons on the Staff page: "Change role" and "Edit". "Remove" moves into the Edit panel as "Remove from business".

## Review Focus

- Actor's own permission was removed, then they promote a colleague to manager: must be refused (Task 5 test).
- Target keeps an extra permission the editor lacks while the editor changes other ticks: must succeed (only newly granted permissions are checked).
- A role change on a customised person: overrides cleared, audit row written (Task 5 test).
- Alert fan-out: a person whose `VIEW_INVENTORY` was removed gets no low-stock alert, and a counter person who was granted it does (Task 4 test).
- Two admins edit the same person at once: the second sees the first's committed state (same row locks as role changes; covered by reusing `authorizeMutationLocked`).

---

## File structure

- Create `packages/backend-shared/src/auth/effective-permissions.ts` (+ `.spec.ts`): pure access logic.
- Modify `packages/backend-shared/src/index.ts`: export it.
- Create migration `services/api/prisma/migrations/20261017120000_staff_access_overrides/migration.sql`; modify `services/api/prisma/schema.prisma`.
- Modify `services/api/src/auth/shop-membership.service.ts`, `resolve-effective-role.ts`, `permissions.guard.ts`.
- Modify the other readers: `deliveries/delivery-redaction.interceptor.ts`, `shop-settings/shop-settings.service.ts`, `shop-orders/shop-orders.service.ts`, `shop-staff/shop-staff.service.ts`, `packages/backend-shared/src/notifications/staff-notifications.ts`, `notification-center/notification-center.service.ts`.
- Modify `print-jobs/print-jobs.controller.ts`, `shop-agents/shop-agents.controller.ts` (role lists).
- Modify `shop-staff/shop-staff.service.ts`, `shop-staff.controller.ts`; create `shop-staff/dto/update-shop-staff-access.dto.ts`; modify `audit/audit-action.ts`.
- Modify `packages/validation/src/shop-staff/*`, `packages/api-client/src/resources/shop-staff.resource.ts`.
- Create `apps/shop-web/src/lib/permission-groups.ts` (+ `.test.ts`); modify `staff-screen.tsx`, `staff-view.ts`.
- Test: `services/api/test/shop-staff-access.e2e-spec.ts`.

---

### Task 1: Effective-permissions logic

**Files:**

- Create: `packages/backend-shared/src/auth/effective-permissions.ts`, `effective-permissions.spec.ts`
- Modify: `packages/backend-shared/src/index.ts`

**Interfaces:**

- Produces:
  - `interface AccessOverrides { extraPermissions: readonly string[]; removedPermissions: readonly string[] }`
  - `const OWNER_ONLY_PERMISSIONS: readonly Permission[]` = `[MANAGE_SETTINGS]`
  - `effectivePermissions(role: UserRole, overrides?: Partial<AccessOverrides>): Permission[]`. SHOP_OWNER and ADMIN ignore overrides.
  - `normalizePermissions(desired: readonly Permission[]): Permission[]`: de-duplicated; adds implied view permissions (`MANAGE_INVENTORY→VIEW_INVENTORY`, `MANAGE_PRINTERS→VIEW_PRINTERS`, `MANAGE_AUTOMATION→VIEW_SETTINGS`, `CREATE_ORDERS`/`EDIT_ORDERS`/`CANCEL_ORDERS→VIEW_ORDERS`).
  - `diffFromRole(role: UserRole, desired: readonly Permission[]): AccessOverrides`: `extra = desired − defaults`, `removed = defaults − desired`, both sorted.

- [ ] **Step 1: Write the failing spec** with these cases:
  - `effectivePermissions("SHOP_COUNTER")` equals `ROLE_PERMISSIONS.SHOP_COUNTER`.
  - Counter with `extraPermissions: ["VIEW_INVENTORY"]` includes it; manager with `removedPermissions: ["VIEW_REPORTS"]` lacks it and keeps the rest.
  - Owner with `removedPermissions: ["MANAGE_USERS"]` still has everything.
  - `normalizePermissions(["MANAGE_INVENTORY"])` contains `VIEW_INVENTORY`.
  - `diffFromRole("SHOP_MANAGER", ROLE_PERMISSIONS.SHOP_MANAGER)` is `{ extraPermissions: [], removedPermissions: [] }`.
  - Round trip: `effectivePermissions(role, diffFromRole(role, d))` equals `d` as a set, for a counter given `VIEW_REPORTS`.
- [ ] **Step 2: Run it and see it fail.** `cd packages/backend-shared && node ../../node_modules/jest/bin/jest.js effective-permissions`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four exports above in `effective-permissions.ts`; export from `index.ts`.
- [ ] **Step 4: Run it and see it pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `git add packages/backend-shared && git commit -m "backend-shared: effective permissions from role plus per-person overrides"`

### Task 2: Storage and the membership lookup

**Files:**

- Modify: `services/api/prisma/schema.prisma` (`ShopStaff`, around line 329); create the migration listed above.
- Modify: `services/api/src/auth/shop-membership.service.ts`, `resolve-effective-role.ts`, `permissions.guard.ts`

**Interfaces:**

- Consumes: Task 1's `effectivePermissions`.
- Produces:
  - `ShopStaff.extraPermissions String[] @default([]) @map("extra_permissions")` and `removedPermissions String[] @default([]) @map("removed_permissions")`.
  - `ShopMembershipService.getAccess(shopId: string, userId: string): Promise<{ role: UserRole; permissions: Permission[] } | null>`: ACTIVE membership only.
  - `resolveEffectiveAccess(context, reflector, moduleRef, shopMembership): Promise<{ role: UserRole; permissions: Permission[] } | undefined>` in `resolve-effective-role.ts`. It uses the membership when the route is shop-scoped and the caller is a member; otherwise the account role with `effectivePermissions(accountRole)`.

- [ ] **Step 1: Write the failing e2e** in `services/api/test/shop-staff-access.e2e-spec.ts`, modelled on `shop-staff-management.e2e-spec.ts`. First case: seed a counter membership with `extraPermissions: ["VIEW_INVENTORY"]`; `GET /v1/inventory/items?shopId=…` as that user returns 200 (it is 403 without the override).
- [ ] **Step 2: Run it and see it fail** (the column does not exist yet).
- [ ] **Step 3: Write the migration** (`ALTER TABLE shop_staff ADD COLUMN extra_permissions text[] NOT NULL DEFAULT '{}', ADD COLUMN removed_permissions text[] NOT NULL DEFAULT '{}'`), update the schema, then `prisma migrate deploy` and `prisma generate`. Verify with `prisma migrate status` and `\d shop_staff` through `docker exec … psql`.
- [ ] **Step 4: Implement** `getAccess` and `resolveEffectiveAccess`; make `PermissionsGuard` use `resolveEffectiveAccess(...).permissions`. `RolesGuard` keeps using the role.
- [ ] **Step 5: Run the e2e and the `permissions.guard.spec.ts` unit spec.** Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 3: Move every member-permission reader to the effective access

**Files:**

- Modify: `delivery-redaction.interceptor.ts` (use `resolveEffectiveAccess`), `shop-settings.service.ts` `assertMayChange`, `shop-orders.service.ts` `getHistory`, `shop-staff.service.ts` (`myShops` and `directory`), `print-jobs.controller.ts` and `shop-agents.controller.ts` (`@Roles` widened to `SHOP_COUNTER, SHOP_MANAGER, SHOP_OWNER, OPERATOR, PRINTER_MANAGER`; the permission decorators already gate every route).

**Interfaces:**

- Consumes: `getAccess`, `resolveEffectiveAccess` from Task 2.
- Produces: `MyShopMembership.permissions` now reflects overrides, so `/me` and the web navigation follow automatically.

- [ ] **Step 1: Write the failing e2e cases** in the same spec file:
  - `/v1/shop/staff/me` lists `VIEW_INVENTORY` for the override counter.
  - A counter with `extraPermissions: ["ASSIGN_JOBS"]` can call a print-job reassign route that is 403 today (it passes the role gate once widened).
  - A manager with `removedPermissions: ["MANAGE_DELIVERY"]` gets the delivery address redacted in order responses.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Replace each `ROLE_PERMISSIONS[...]` member lookup** with the effective access, as listed under Files. Leave `ROLE_PERMISSIONS` itself as the defaults table.
- [ ] **Step 4: Run** `shop-staff-management`, `shop-staff-invites`, `authorization-matrix` and `authorization-matrix-v2` e2e plus the new spec. Expected: PASS, no regressions.
- [ ] **Step 5: Commit.**

### Task 4: Staff alerts respect overrides

**Files:**

- Modify: `packages/backend-shared/src/notifications/staff-notifications.ts` (`notifyShopStaff`), `services/api/src/notification-center/notification-center.service.ts` (`permissionClause`, `markAllRead`/`allowedTypes`), `staff-notifications.spec.ts`

**Interfaces:**

- Consumes: Task 1's `effectivePermissions`.
- Produces: `notifyShopStaff` selects ACTIVE members with `role`, `extraPermissions`, `removedPermissions` and keeps those whose `effectivePermissions` include the alert's permission (`rolesWithPermission` stays for the role defaults). The notification-centre SQL becomes: held if `(role ∈ rolesWithPermission(p) OR p = ANY(extra)) AND NOT p = ANY(removed)`. `allowedTypes` takes the member's overrides.

- [ ] **Step 1: Write the failing tests:**
  - A unit test in `staff-notifications.spec.ts` for the new member filter.
  - An e2e: raise a low-stock alert; the operator whose `VIEW_INVENTORY` is removed gets none; a counter with it granted gets one; and a removed person's old alert disappears from `GET /v1/notifications`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** as described. Keep the owner exempt, as in Task 1.
- [ ] **Step 4: Run** the notification-centre and staff-notification e2e and unit specs. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: The access-editing API and the no-escalation rules

**Files:**

- Modify: `shop-staff.service.ts`, `shop-staff.controller.ts`, `audit/audit-action.ts` (`SHOP_STAFF_ACCESS_CHANGED`), `packages/validation/src/shop-staff/add-shop-staff.schema.ts` and its `index.ts` and the package `index.ts`.
- Create: `shop-staff/dto/update-shop-staff-access.dto.ts`.

**Interfaces:**

- Produces:
  - `updateShopStaffAccessSchema = z.object({ permissions: z.array(z.nativeEnum(Permission)).max(64) })` and `UpdateShopStaffAccessInput`.
  - `PATCH /v1/shop/staff/:id`: `MANAGE_USERS`, `ShopScopeGuard` with `ShopStaffShopResolver`. Returns `ShopStaffMemberResponse` plus `permissions: Permission[]`.
  - `ShopStaffService.updateAccess(shopStaffId: string, desired: readonly Permission[], actorId: string): Promise<ShopStaffMemberResponse & { permissions: Permission[] }>`.
  - `ShopStaffListItem` gains `permissions: Permission[]` and `customised: boolean`.
  - `authorizeMutationLocked` also reads each locked row's `extra_permissions` and `removed_permissions` and returns `{ target, actorPermissions }`. When `newRole` is given, every permission in `effectivePermissions(newRole)` must be in `actorPermissions`; otherwise 403 naming the missing permission. This one check covers add, Change role and invites.

- [ ] **Step 1: Write the failing e2e cases** (names are the test titles):
  - "an owner can tick a permission on for a counter and it takes effect".
  - "a manager cannot edit their own access", and "nobody edits an owner's access".
  - "a manager cannot grant a permission they do not hold".
  - "ticking MANAGE_SETTINGS for a non-owner is refused".
  - "ticking MANAGE_INVENTORY also grants VIEW_INVENTORY".
  - "Change role clears custom access and writes an audit row".
  - "a manager whose VIEW_REPORTS was removed cannot promote someone to manager" (by Change role and by invite).
  - "unchanged permissions the editor lacks do not block an edit".
  - "each edit writes SHOP_STAFF_ACCESS_CHANGED with before and after".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** `updateAccess`. It runs in one transaction after `authorizeMutationLocked` (same rank rules as role changes). The rules, in order:
  - refuse editing yourself or an owner;
  - normalise the desired list;
  - refuse owner-only permissions;
  - require newly granted permissions (desired minus the target's current effective set) to be a subset of the actor's;
  - store `diffFromRole`.

  `changeRole` also sets both arrays to `[]`; audit as the spec says.

- [ ] **Step 4: Run** the new spec plus `shop-staff-management` and `shop-staff-invites`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Client packages

**Files:**

- Modify: `packages/api-client/src/resources/shop-staff.resource.ts`, `packages/api-client/src/index.ts`

**Interfaces:**

- Consumes: Task 5's endpoint and response shapes.
- Produces: `ShopStaffResource.updateAccess(membershipId: string, permissions: string[]): Promise<ShopStaffMember & { permissions: string[] }>`; `ShopStaffListItem` gains `permissions: string[]` and `customised: boolean`.

- [ ] **Step 1:** Add the method and fields; rebuild `validation` and `api-client` (`pnpm --filter @print-automated/api-client build`).
- [ ] **Step 2:** Run `pnpm --filter @print-automated/api-client typecheck`. Expected: clean.
- [ ] **Step 3: Commit.**

### Task 7: The Edit panel and the buttons

**Files:**

- Create: `apps/shop-web/src/lib/permission-groups.ts`, `permission-groups.test.ts`
- Modify: `apps/shop-web/src/components/staff/staff-screen.tsx`, `apps/shop-web/src/lib/staff-view.ts`

**Interfaces:**

- Consumes: Task 6's `updateAccess`; the existing `FormDialog`, `RemoveDialog`, `useActionRunner`.
- Produces:
  - `PERMISSION_GROUPS: ReadonlyArray<{ title: string; items: ReadonlyArray<{ permission: Permission; label: string }> }>`: Orders; Production and print jobs; Printers; Stock and suppliers; Catalogue and prices; Reports and dashboards; Staff; Settings. Every `Permission` appears exactly once.
  - `impliedPermissions(selected: ReadonlySet<Permission>): ReadonlySet<Permission>` mirroring the server's manage-implies-view.
  - `grantableForEditor(editorPermissions: ReadonlySet<Permission>, targetCurrent: ReadonlySet<Permission>): (p: Permission) => boolean`: true when the editor holds it, or the target already has it. `MANAGE_SETTINGS` is always false.

- [ ] **Step 1: Write the failing test** `permission-groups.test.ts`:
  - every permission is in exactly one group;
  - `impliedPermissions(new Set(["MANAGE_INVENTORY"]))` includes `VIEW_INVENTORY`;
  - `grantableForEditor` is false for a permission the editor lacks and the target lacks, true when the target already holds it, and false for `MANAGE_SETTINGS`.
- [ ] **Step 2: Run it and see it fail.** `pnpm --filter @print-automated/shop-web test -- permission-groups`.
- [ ] **Step 3: Implement the lib module.**
- [ ] **Step 4: Change the row buttons** in `staff-screen.tsx`: "Change role" and **"Edit"** (the old "Remove" button goes). Add `{ kind: "edit"; member }` to the `Dialog` union and an `EditDialog`:
  - a grouped checklist with a "custom" marker where it differs from the role's defaults;
  - "Reset to role defaults";
  - disabled lines with the reason;
  - Save, calling `updateAccess`;
  - a "Remove from business" danger section that opens the existing `RemoveDialog`.

  Show a "Custom access" pill on customised rows. In the Change role dialog, add a notice when the person has custom access: "Changing the role resets their custom access."

- [ ] **Step 5: Verify** with `pnpm --filter @print-automated/shop-web lint typecheck test build` and a Playwright route-fixture check of the Staff page (the setup in the project memory note `reference_shop_web_browser_check`): the two buttons, the panel, save, and remove from inside it.
- [ ] **Step 6: Commit.**

### Task 8: Whole-feature verification

- [ ] **Step 1:** Run `pnpm lint`, `pnpm typecheck`, `pnpm test` from the repo root. Expected: all green.
- [ ] **Step 2:** Run the full API e2e suites for staff, invites, authorization matrices, notifications, inventory and print jobs. Expected: PASS.
- [ ] **Step 3:** Walk the real journey on the dev stack as owner, then as the edited person: tick a permission on, see the new menu item, tick it off, see it disappear. Only touch staff rows you created.
- [ ] **Step 4:** `git diff --stat main..HEAD`, `git status`, and confirm nothing is pushed. Update the spec's status line to "step 1 implemented".
