/** Every shop-owned resource type (orders, printers, print_jobs, ...)
 * gets its own resolver implementing this, registered as a provider in
 * that resource's own module. ShopScopeGuard is resource-type-agnostic
 * -- it only knows how to ask "what shop owns this id?" and compare the
 * answer to the actor's shop_staff membership. */
export interface ShopResourceResolver {
  resolveShopId(resourceId: string): Promise<string | null>;
}
