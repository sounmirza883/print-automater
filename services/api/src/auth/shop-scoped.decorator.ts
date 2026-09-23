import { applyDecorators, SetMetadata, type Type } from "@nestjs/common";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";

export const SHOP_SCOPE_PARAM_KEY = "shopScopeParam";
export const SHOP_SCOPE_RESOLVER_KEY = "shopScopeResolver";
export const SHOP_SCOPE_FIELD_KEY = "shopScopeField";

export interface ShopScopeFieldMeta {
  source: "body" | "query";
  field: string;
}

/** @ShopScoped('orderId', OrderShopResolver) on a route with a matching
 * :orderId param: ShopScopeGuard resolves that order's shop via the
 * given resolver and 403s unless the authenticated actor is active
 * shop_staff at that shop. `resolver` must be a provider registered in
 * the same module as the guarded controller. */
export function ShopScoped(
  paramName: string,
  resolver: Type<ShopResourceResolver>,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(SHOP_SCOPE_PARAM_KEY, paramName),
    SetMetadata(SHOP_SCOPE_RESOLVER_KEY, resolver),
  );
}

/** For routes with no single route-param resource to resolve a shop id
 * from (a `shopId` supplied directly in the body or query, e.g.
 * register-printer or list-orders) -- marks where to read it from so
 * RolesGuard/PermissionsGuard can resolve the *effective*, per-shop
 * (ShopStaff.role) role for these routes too, not just id-param ones.
 * This is role/permission *resolution* metadata only; it does not by
 * itself enforce membership -- these routes already enforce that via
 * ShopMembershipService inside their own service methods. */
export function ShopScopedField(source: "body" | "query", field = "shopId"): MethodDecorator {
  return SetMetadata(SHOP_SCOPE_FIELD_KEY, { source, field } satisfies ShopScopeFieldMeta);
}
