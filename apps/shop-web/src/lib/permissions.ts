import { Permission, UserRole } from "@print-automated/types";

/** Client-side MIRROR of packages/backend-shared's `ROLE_PERMISSIONS`,
 * used ONLY to decide which navigation items and buttons to show.
 * Enforcement is server-side (`PermissionsGuard`): hiding an item here
 * never grants or denies anything, and a stale mirror can at worst show
 * a link the API then answers 403 (handled by `ForbiddenState`).
 *
 * It is a mirror rather than an import because backend-shared drags the
 * whole server stack (Prisma, BullMQ, AWS SDK) into whatever imports it.
 * `permissions.test.ts` imports the real table and fails on any drift,
 * so keep the two in step by keeping that test green. The durable fix
 * is for `GET /v1/shop/staff/me` to return each membership's effective
 * permission list (backend carry-forward). */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CUSTOMER: [],
  SUPPLIER: [],
  SHOP_COUNTER: [
    Permission.VIEW_ORDERS,
    Permission.CREATE_ORDERS,
    Permission.EDIT_ORDERS,
    Permission.MANAGE_DELIVERY,
  ],
  OPERATOR: [
    Permission.VIEW_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.QUALITY_CHECK,
    Permission.VIEW_INVENTORY,
    Permission.VIEW_OPERATOR_DASHBOARD,
    Permission.VIEW_PRINTER_DASHBOARD,
  ],
  PRINTER_MANAGER: [
    Permission.VIEW_ORDERS,
    Permission.MANAGE_PRINTERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.QUALITY_CHECK,
    Permission.REPRINT_JOBS,
    Permission.VIEW_INVENTORY,
    Permission.VIEW_OPERATOR_DASHBOARD,
    Permission.VIEW_PRINTER_DASHBOARD,
  ],
  SHOP_MANAGER: [
    Permission.VIEW_ORDERS,
    Permission.CREATE_ORDERS,
    Permission.EDIT_ORDERS,
    Permission.CANCEL_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.QUALITY_CHECK,
    Permission.REPRINT_JOBS,
    Permission.MANAGE_DELIVERY,
    Permission.MANAGE_PRINTERS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_SUPPLIERS,
    Permission.MANAGE_PRICES,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_USERS,
    Permission.VIEW_SETTINGS,
    Permission.MANAGE_AUTOMATION,
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_OPERATOR_DASHBOARD,
    Permission.VIEW_PRINTER_DASHBOARD,
  ],
  SHOP_OWNER: [
    Permission.VIEW_ORDERS,
    Permission.CREATE_ORDERS,
    Permission.EDIT_ORDERS,
    Permission.CANCEL_ORDERS,
    Permission.ASSIGN_JOBS,
    Permission.PAUSE_JOBS,
    Permission.RECORD_JOB_FAILURE,
    Permission.QUALITY_CHECK,
    Permission.REPRINT_JOBS,
    Permission.MANAGE_DELIVERY,
    Permission.MANAGE_PRINTERS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
    Permission.MANAGE_SUPPLIERS,
    Permission.MANAGE_PRICES,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_USERS,
    Permission.MANAGE_SETTINGS,
    Permission.VIEW_SETTINGS,
    Permission.MANAGE_AUTOMATION,
    Permission.VIEW_DASHBOARD,
    Permission.VIEW_OPERATOR_DASHBOARD,
    Permission.VIEW_PRINTER_DASHBOARD,
  ],
  ADMIN: Object.values(Permission),
};

/** Accounts allowed to sign in to the back office at all. A CUSTOMER or
 * SUPPLIER account is refused at sign-in (they belong on customer-web). */
export const BACK_OFFICE_ROLES: readonly UserRole[] = [
  UserRole.SHOP_OWNER,
  UserRole.SHOP_MANAGER,
  UserRole.SHOP_COUNTER,
  UserRole.OPERATOR,
  UserRole.PRINTER_MANAGER,
  UserRole.ADMIN,
];

export function isBackOfficeRole(role: string): role is UserRole {
  return (BACK_OFFICE_ROLES as readonly string[]).includes(role);
}

export function permissionsForRole(role: UserRole | null | undefined): ReadonlySet<Permission> {
  return new Set(role ? ROLE_PERMISSIONS[role] : []);
}

const ROLE_LABELS: Record<UserRole, string> = {
  CUSTOMER: "Customer",
  SUPPLIER: "Supplier",
  SHOP_OWNER: "Owner",
  SHOP_MANAGER: "Manager",
  SHOP_COUNTER: "Counter staff",
  OPERATOR: "Operator",
  PRINTER_MANAGER: "Printer manager",
  ADMIN: "Platform admin",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}
