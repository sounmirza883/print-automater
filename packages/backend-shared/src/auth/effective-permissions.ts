import type { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { ROLE_PERMISSIONS } from "./role-permissions.js";

/** What a membership stores on top of its role: the DIFFERENCE from the role's defaults, so a
 * later change to a role's defaults still reaches everyone not customised on that permission. */
export interface AccessOverrides {
  extraPermissions: readonly string[];
  removedPermissions: readonly string[];
}

/** Business-level configuration and billing: never granted to a non-owner. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = [Permission.MANAGE_SETTINGS];

/** A permission that is useless without a companion read permission. The server adds the
 * companion when a list is saved; the staff screen mirrors this table. */
const IMPLIES: ReadonlyArray<readonly [Permission, Permission]> = [
  [Permission.MANAGE_INVENTORY, Permission.VIEW_INVENTORY],
  [Permission.MANAGE_PRINTERS, Permission.VIEW_PRINTERS],
  [Permission.MANAGE_AUTOMATION, Permission.VIEW_SETTINGS],
  [Permission.CREATE_ORDERS, Permission.VIEW_ORDERS],
  [Permission.EDIT_ORDERS, Permission.VIEW_ORDERS],
  [Permission.CANCEL_ORDERS, Permission.VIEW_ORDERS],
];

/** Owners and platform admins always hold their full set: overrides never apply to them. */
function ignoresOverrides(role: UserRole): boolean {
  return role === "SHOP_OWNER" || role === "ADMIN";
}

/** `(ROLE_PERMISSIONS[role] ∪ extra) − removed`. The ONE place a member's permissions are
 * computed; guards, `/me` and alert fan-out all go through it. */
export function effectivePermissions(
  role: UserRole,
  overrides: Partial<AccessOverrides> = {},
): Permission[] {
  const defaults = ROLE_PERMISSIONS[role] ?? [];
  if (ignoresOverrides(role)) {
    return [...defaults];
  }
  const held = new Set<string>(defaults);
  for (const permission of overrides.extraPermissions ?? []) held.add(permission);
  for (const permission of overrides.removedPermissions ?? []) held.delete(permission);
  return [...held] as Permission[];
}

/** De-duplicates a desired list and adds the read permission each manage permission needs. */
export function normalizePermissions(desired: readonly Permission[]): Permission[] {
  const result = new Set<Permission>(desired);
  for (const [permission, needed] of IMPLIES) {
    if (result.has(permission)) result.add(needed);
  }
  return [...result];
}

/** The overrides that turn `role`'s defaults into `desired`. */
export function diffFromRole(role: UserRole, desired: readonly Permission[]): AccessOverrides {
  const defaults = new Set<string>(ROLE_PERMISSIONS[role] ?? []);
  const wanted = new Set<string>(desired);
  return {
    extraPermissions: [...wanted].filter((p) => !defaults.has(p)).sort(),
    removedPermissions: [...defaults].filter((p) => !wanted.has(p)).sort(),
  };
}
