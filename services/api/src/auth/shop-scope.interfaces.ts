/** Every shop-owned resource type (orders, printers, print_jobs, ...)
 * gets its own resolver implementing this, registered as a provider in
 * that resource's own module. ShopScopeGuard is resource-type-agnostic
 * -- it only knows how to ask "what shop owns this id?" and compare the
 * answer to the actor's shop_staff membership. */
export interface ShopResourceResolver {
  resolveShopId(resourceId: string): Promise<string | null>;
  /** Resources that belong to a BRANCH of the business (orders, print jobs, printers) also say
   * which one, in the same single lookup, so ShopScopeGuard can refuse a branch-bound member
   * whose branch differs. Business-wide resources (products, suppliers, ...) leave this out and
   * are checked against the shop only. */
  resolveScope?(resourceId: string): Promise<ResourceScope | null>;
}

/** Where a resource lives: its business, and the branch within it when it has one. */
export interface ResourceScope {
  shopId: string;
  branchId: string | null;
}
