import { UserRole, type Permission } from "@print-automated/types";

/** What the signed-in person may do at the selected business, straight from
 * `GET /v1/shop/staff/me` (23.15): the API sends each membership's effective
 * permission list, taken from the server's own ROLE_PERMISSIONS table, so the
 * back office never keeps a copy of that table (the copy it had drifted the
 * moment 23.14/23.15 added VIEW_PRINTERS and VIEW_STAFF_DIRECTORY).
 *
 * Used ONLY to decide which navigation items and buttons to show;
 * `PermissionsGuard` enforces every request. A membership without a list
 * yields nothing (fail closed): at worst a control is hidden that the server
 * would have allowed, never the reverse. */
export function membershipPermissions(
  membership: { permissions?: readonly Permission[] } | null | undefined,
): ReadonlySet<Permission> {
  return new Set(membership?.permissions ?? []);
}

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
