import { ForbiddenException, type ExecutionContext, type Type } from "@nestjs/common";
import { ShopScopeGuard } from "./shop-scope.guard.js";
import { SHOP_SCOPE_PARAM_KEY, SHOP_SCOPE_RESOLVER_KEY } from "./shop-scoped.decorator.js";
import type { ResourceScope, ShopResourceResolver } from "./shop-scope.interfaces.js";
import type { MemberAccess, ShopMembershipService } from "./shop-membership.service.js";

/** A resource that belongs to a branch: orders, print jobs and printers resolve a scope. */
class BranchOwnedResolver implements ShopResourceResolver {
  async resolveShopId(id: string): Promise<string | null> {
    return (await this.resolveScope(id))?.shopId ?? null;
  }
  async resolveScope(id: string): Promise<ResourceScope | null> {
    if (id === "in-branch-a") return { shopId: "shop-1", branchId: "branch-a" };
    if (id === "in-branch-b") return { shopId: "shop-1", branchId: "branch-b" };
    return null;
  }
}

/** A business-wide resource (a product, a supplier): only the shop is known. */
class ShopOnlyResolver implements ShopResourceResolver {
  async resolveShopId(id: string): Promise<string | null> {
    return id === "product" ? "shop-1" : null;
  }
}

describe("ShopScopeGuard (membership plus branch)", () => {
  function member(branchId: string | null): MemberAccess {
    return { role: "SHOP_MANAGER", permissions: [], branchId };
  }

  function guardFor(
    resolver: Type<ShopResourceResolver>,
    access: MemberAccess | null,
  ): ShopScopeGuard {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === SHOP_SCOPE_PARAM_KEY
          ? "id"
          : key === SHOP_SCOPE_RESOLVER_KEY
            ? resolver
            : undefined,
    };
    const moduleRef = { get: () => new resolver() };
    const membership: Pick<ShopMembershipService, "getAccess"> = {
      getAccess: async (shopId: string) => (shopId === "shop-1" ? access : null),
    };
    return new ShopScopeGuard(reflector as never, moduleRef as never, membership as never);
  }

  const context = (id: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { id: "u1" }, params: { id } }) }),
      getHandler: () => (): void => undefined,
      getClass: () => class {},
    }) as unknown as ExecutionContext;

  it("lets a person at the resource's branch through", async () => {
    const guard = guardFor(BranchOwnedResolver, member("branch-a"));
    await expect(guard.canActivate(context("in-branch-a"))).resolves.toBe(true);
  });

  it("refuses a branch-bound person on another branch's resource", async () => {
    const guard = guardFor(BranchOwnedResolver, member("branch-a"));
    await expect(guard.canActivate(context("in-branch-b"))).rejects.toThrow(ForbiddenException);
  });

  it("lets an all-branches person through to either branch", async () => {
    const guard = guardFor(BranchOwnedResolver, member(null));
    await expect(guard.canActivate(context("in-branch-a"))).resolves.toBe(true);
    await expect(guard.canActivate(context("in-branch-b"))).resolves.toBe(true);
  });

  it("still refuses someone who is not on the business's staff at all", async () => {
    const guard = guardFor(BranchOwnedResolver, null);
    await expect(guard.canActivate(context("in-branch-a"))).rejects.toThrow(ForbiddenException);
  });

  it("refuses an unknown resource", async () => {
    const guard = guardFor(BranchOwnedResolver, member(null));
    await expect(guard.canActivate(context("nope"))).rejects.toThrow(ForbiddenException);
  });

  it("does not apply a branch check to a business-wide resource, even for a branch-bound person", async () => {
    const guard = guardFor(ShopOnlyResolver, member("branch-a"));
    await expect(guard.canActivate(context("product"))).resolves.toBe(true);
  });
});
