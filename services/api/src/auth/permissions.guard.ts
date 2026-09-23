import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import type { Permission } from "@print-automated/types";
import { ROLE_PERMISSIONS } from "@print-automated/backend-shared";
import { PERMISSION_KEY } from "./require-permission.decorator.js";
import type { RequestWithUser } from "./jwt-auth.guard.js";
import { ShopMembershipService } from "./shop-membership.service.js";
import { resolveEffectiveRole } from "./resolve-effective-role.js";

/** §47/16.2: `JwtAuthGuard -> RolesGuard -> PermissionsGuard ->
 * ShopScopeGuard`. Reads the EFFECTIVE role the same way RolesGuard
 * does (16.1's `ShopStaff.role` in shop context, else the account-
 * level `User.role`) and checks it against `ROLE_PERMISSIONS`, data
 * rather than scattered role branches. A route with no
 * `@RequirePermission()` has nothing to enforce here -- `@Roles()`
 * alone is still a complete, valid gate for routes that don't need
 * finer-grained differentiation. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredPermission) {
      return true; // no @RequirePermission() on this route -- nothing to enforce
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new ForbiddenException("Insufficient permission for this resource.");
    }

    const effectiveRole = await resolveEffectiveRole(
      context,
      this.reflector,
      this.moduleRef,
      this.shopMembership,
    );

    const permissions = effectiveRole ? (ROLE_PERMISSIONS[effectiveRole] ?? []) : [];
    if (!permissions.includes(requiredPermission)) {
      throw new ForbiddenException("Insufficient permission for this resource.");
    }

    return true;
  }
}
