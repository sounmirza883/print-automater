import type { ExecutionContext, Type } from "@nestjs/common";
import type { ModuleRef, Reflector } from "@nestjs/core";
import type { UserRole } from "@prisma/client";
import {
  SHOP_SCOPE_FIELD_KEY,
  SHOP_SCOPE_PARAM_KEY,
  SHOP_SCOPE_RESOLVER_KEY,
  type ShopScopeFieldMeta,
} from "./shop-scoped.decorator.js";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";
import type { RequestWithUser } from "./jwt-auth.guard.js";
import { effectivePermissions } from "@print-automated/backend-shared";
import type { MemberAccess, ShopMembershipService } from "./shop-membership.service.js";

/** Shared by RolesGuard (16.1) and PermissionsGuard (16.2): resolves the
 * shop id a route is operating on, via whichever of the two shop-scope
 * metadata shapes the route declares --
 *   - `@ShopScoped(param, resolver)`: a route-param resource id, looked
 *     up through its resolver (the existing pattern ShopScopeGuard uses
 *     for membership checks).
 *   - `@ShopScopedField(source, field)`: the shop id supplied directly
 *     in the body/query (register-printer, list-orders, ...).
 * Returns null when neither is declared -- a non-shop-scoped route
 * (auth, admin), for which the caller should fall back to the
 * account-level `User.role`. */
export async function resolveContextShopId(
  context: ExecutionContext,
  reflector: Reflector,
  moduleRef: ModuleRef,
): Promise<string | null> {
  const request = context.switchToHttp().getRequest<RequestWithUser>();

  const paramName = reflector.getAllAndOverride<string | undefined>(SHOP_SCOPE_PARAM_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  const resolverType = reflector.getAllAndOverride<Type<ShopResourceResolver> | undefined>(
    SHOP_SCOPE_RESOLVER_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (paramName && resolverType) {
    const rawParam: unknown = request.params[paramName];
    if (typeof rawParam !== "string" || rawParam.length === 0) {
      return null;
    }
    const resolver = moduleRef.get(resolverType, { strict: false });
    return resolver.resolveShopId(rawParam);
  }

  const fieldMeta = reflector.getAllAndOverride<ShopScopeFieldMeta | undefined>(
    SHOP_SCOPE_FIELD_KEY,
    [context.getHandler(), context.getClass()],
  );
  if (fieldMeta) {
    const source: unknown = fieldMeta.source === "body" ? request.body : request.query;
    const raw = (source as Record<string, unknown> | undefined)?.[fieldMeta.field];
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }

  return null;
}

/** Resolves the effective role for THIS request: `ShopStaff.role` when
 * the route declares shop scope and the caller is an active member of
 * that specific shop, else the account-level `User.role`. Never throws
 * -- a route with declared shop scope but no membership simply falls
 * back to the account role, which downstream membership checks
 * (ShopScopeGuard / the service's own ShopMembershipService call) are
 * still responsible for denying. */
export async function resolveEffectiveRole(
  context: ExecutionContext,
  reflector: Reflector,
  moduleRef: ModuleRef,
  shopMembership: ShopMembershipService,
): Promise<UserRole | undefined> {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  const accountRole = request.user?.role;
  if (!accountRole || !request.user) {
    return accountRole;
  }

  const shopId = await resolveContextShopId(context, reflector, moduleRef);
  if (!shopId) {
    return accountRole;
  }

  const effectiveRole = await shopMembership.getEffectiveRole(shopId, request.user.id);
  return effectiveRole ?? accountRole;
}

/** Like `resolveEffectiveRole`, but also carries the permissions the caller holds for THIS
 * request: a member's role defaults plus their own overrides at the request's shop, else the
 * account role's plain defaults. */
export async function resolveEffectiveAccess(
  context: ExecutionContext,
  reflector: Reflector,
  moduleRef: ModuleRef,
  shopMembership: ShopMembershipService,
): Promise<MemberAccess | undefined> {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  const accountRole = request.user?.role;
  if (!accountRole || !request.user) {
    return undefined;
  }

  const shopId = await resolveContextShopId(context, reflector, moduleRef);
  const access = shopId ? await shopMembership.getAccess(shopId, request.user.id) : null;
  return (
    access ?? { role: accountRole, permissions: effectivePermissions(accountRole), branchId: null }
  );
}
