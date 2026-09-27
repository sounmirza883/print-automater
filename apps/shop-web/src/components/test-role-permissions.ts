import type { Permission, UserRole } from "@print-automated/types";
// TEST SUPPORT ONLY -- never import this from app code. The real, server-side table, read by
// path so shop-web itself never depends on backend-shared; fixtures built from it can never
// drift from what `GET /v1/shop/staff/me` would report for the role.
import { ROLE_PERMISSIONS } from "../../../../packages/backend-shared/src/auth/role-permissions";

/** The permission list the API reports for `role` at a business. */
export function serverPermissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
