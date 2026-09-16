import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  type Type,
} from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { SHOP_SCOPE_PARAM_KEY, SHOP_SCOPE_RESOLVER_KEY } from "./shop-scoped.decorator.js";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";
import type { RequestWithUser } from "./jwt-auth.guard.js";
import { ShopMembershipService } from "./shop-membership.service.js";

/** §81/§82: resolves the target resource's shop_id (via the per-route
 * resolver) and denies access unless the authenticated actor is active
 * staff at that specific shop. Apply after JwtAuthGuard. */
@Injectable()
export class ShopScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const paramName = this.reflector.getAllAndOverride<string | undefined>(SHOP_SCOPE_PARAM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const resolverType = this.reflector.getAllAndOverride<Type<ShopResourceResolver> | undefined>(
      SHOP_SCOPE_RESOLVER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!paramName || !resolverType) {
      return true; // not @ShopScoped -- nothing to check
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new ForbiddenException("Authentication required for shop-scoped resource.");
    }

    const rawParam: unknown = request.params[paramName];
    if (typeof rawParam !== "string" || rawParam.length === 0) {
      throw new ForbiddenException(`Missing route parameter "${paramName}" for shop scope check.`);
    }
    const resourceId = rawParam;

    const resolver = this.moduleRef.get(resolverType, { strict: false });
    const resourceShopId = await resolver.resolveShopId(resourceId);
    if (!resourceShopId) {
      throw new ForbiddenException("Resource not found.");
    }

    const isMember = await this.shopMembership.isActiveStaff(resourceShopId, request.user.id);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's resource.");
    }

    return true;
  }
}
