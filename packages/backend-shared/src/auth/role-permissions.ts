import type { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";

/** §47/16.2: the role -> permission catalog, as DATA -- consumed by
 * PermissionsGuard, never re-derived as scattered `if (role === ...)`
 * branches through route handlers. Every `UserRole` has an entry
 * (exhaustiveness enforced by role-permissions.spec.ts), even an empty
 * array for roles with no shop-side permissions today (CUSTOMER,
 * SUPPLIER -- a future supplier portal is out of this phase's scope).
 *
 * Judgment calls (16.3's own per-role differentiation, documented once
 * here rather than re-justified at each call site):
 *   - SHOP_OWNER: everything, including MANAGE_SETTINGS -- the one
 *     permission SHOP_MANAGER does NOT get, keeping business-level
 *     configuration (§75/§76) owner-only.
 *   - SHOP_MANAGER: everything an owner has except MANAGE_SETTINGS.
 *   - SHOP_COUNTER: front-of-house order handling only -- view/create/
 *     edit orders. No ASSIGN_JOBS (reassigning a job to a different
 *     printer), no MANAGE_PRINTERS, no MANAGE_USERS.
 *   - OPERATOR: production-floor -- views orders and assigns/handles
 *     print jobs, nothing administrative.
 *   - Inventory (20.2): VIEW_INVENTORY for OPERATOR and PRINTER_MANAGER (they load
 *     paper and need to see stock); MANAGE_INVENTORY (change stock) only for
 *     SHOP_MANAGER/SHOP_OWNER; SHOP_COUNTER has neither.
 *   - PRINTER_MANAGER: owns the printer fleet -- MANAGE_PRINTERS and
 *     ASSIGN_JOBS, plus VIEW_ORDERS to see what's queued; no order
 *     editing, pricing, or staff management.
 *   - ADMIN: platform-level, not shop-level -- gated by `@Roles(ADMIN)`
 *     on its own dedicated `/admin/*` routes (16.5), never by
 *     `@RequirePermission`. Given the full set anyway so a permission
 *     check is never the accidental reason an admin route is denied. */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  CUSTOMER: [],
  SUPPLIER: [],
  SHOP_COUNTER: [Permission.VIEW_ORDERS, Permission.CREATE_ORDERS, Permission.EDIT_ORDERS],
  OPERATOR: [
    Permission.VIEW_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.VIEW_INVENTORY,
  ],
  PRINTER_MANAGER: [
    Permission.VIEW_ORDERS,
    Permission.MANAGE_PRINTERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.VIEW_INVENTORY,
  ],
  SHOP_MANAGER: [
    Permission.VIEW_ORDERS,
    Permission.CREATE_ORDERS,
    Permission.EDIT_ORDERS,
    Permission.CANCEL_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.MANAGE_PRINTERS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_SUPPLIERS,
    Permission.MANAGE_PRICES,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_USERS,
  ],
  SHOP_OWNER: [
    Permission.VIEW_ORDERS,
    Permission.CREATE_ORDERS,
    Permission.EDIT_ORDERS,
    Permission.CANCEL_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.MANAGE_PRINTERS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_SUPPLIERS,
    Permission.MANAGE_PRICES,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_USERS,
    Permission.MANAGE_SETTINGS,
  ],
  ADMIN: Object.values(Permission),
};
