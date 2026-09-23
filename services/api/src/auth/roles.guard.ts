import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import type { UserRole } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator.js";
import type { RequestWithUser } from "./jwt-auth.guard.js";
import { ShopMembershipService } from "./shop-membership.service.js";
import { resolveEffectiveRole } from "./resolve-effective-role.js";

/** §46/16.1: shop-context-aware. A route declaring shop scope
 * (`@ShopScoped`/`@ShopScopedField`) is checked against the caller's
 * `ShopStaff.role` AT THAT SHOP, not their account-level `User.role` --
 * the same person can be SHOP_MANAGER at one shop and SHOP_COUNTER (or
 * nothing) at another. A route with no declared shop scope (auth,
 * admin) keeps checking the account-level role exactly as before. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles() on this route -- nothing to enforce
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new ForbiddenException("Insufficient role for this resource.");
    }

    const effectiveRole = await resolveEffectiveRole(
      context,
      this.reflector,
      this.moduleRef,
      this.shopMembership,
    );

    if (!effectiveRole || !requiredRoles.includes(effectiveRole)) {
      throw new ForbiddenException("Insufficient role for this resource.");
    }

    return true;
  }
}
