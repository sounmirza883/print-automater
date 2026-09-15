import { applyDecorators, SetMetadata, type Type } from "@nestjs/common";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";

export const SHOP_SCOPE_PARAM_KEY = "shopScopeParam";
export const SHOP_SCOPE_RESOLVER_KEY = "shopScopeResolver";

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
