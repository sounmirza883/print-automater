import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@print-automated/types";

export const PERMISSION_KEY = "requiredPermission";

/** §47/16.2. Apply after `@Roles(...)`, on routes needing real
 * per-role differentiation beyond "any of these account/shop roles."
 * Checked by PermissionsGuard against the EFFECTIVE role (16.1's
 * `ShopStaff.role` when in shop context, else the account-level
 * `User.role`) via `ROLE_PERMISSIONS`. */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, permission);
