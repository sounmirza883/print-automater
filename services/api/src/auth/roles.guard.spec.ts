import { ForbiddenException, type ExecutionContext, type Type } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { RolesGuard } from "./roles.guard.js";
import { ROLES_KEY } from "./roles.decorator.js";
import { SHOP_SCOPE_PARAM_KEY, SHOP_SCOPE_RESOLVER_KEY } from "./shop-scoped.decorator.js";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";
import type { ShopMembershipService } from "./shop-membership.service.js";

class FakePrinterShopResolver implements ShopResourceResolver {
  async resolveShopId(printerId: string): Promise<string | null> {
    return printerId === "printer-in-shop-a" ? "shop-a" : "shop-b";
  }
}

/** §46/16.1's own Done-when, at the mechanism level: a user whose
 * account-level `User.role` is SHOP_COUNTER but whose `ShopStaff.role`
 * at one specific shop is SHOP_MANAGER must be evaluated as MANAGER
 * for a route scoped to that shop -- and only that shop. No production
 * route requires MANAGER yet (16.3's job), so this proves the guard's
 * own resolution logic directly against a mocked shop-scoped route,
 * exactly the way ShopScopeGuard's resolver mechanism already works. */
describe("RolesGuard (16.1: ShopStaff.role is authoritative for shop-scoped routes)", () => {
  function buildContext(params: Record<string, string>): ExecutionContext {
    const request = { user: { id: "user-1", role: UserRole.SHOP_COUNTER }, params };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => (): void => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  function buildReflector(requiredRoles: UserRole[]): {
    getAllAndOverride: jest.Mock;
  } {
    return {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === ROLES_KEY) return requiredRoles;
        if (key === SHOP_SCOPE_PARAM_KEY) return "printerId";
        if (key === SHOP_SCOPE_RESOLVER_KEY) return FakePrinterShopResolver as Type<unknown>;
        return undefined;
      }),
    };
  }

  function buildModuleRef(): { get: jest.Mock } {
    return { get: jest.fn(() => new FakePrinterShopResolver()) };
  }

  it("grants access using ShopStaff.role at the resolved shop, not the account-level User.role", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(async (shopId: string) =>
        shopId === "shop-a" ? UserRole.SHOP_MANAGER : null,
      ),
    };
    const guard = new RolesGuard(
      buildReflector([UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER]) as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );

    const context = buildContext({ printerId: "printer-in-shop-a" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies the same account-role user at a different shop where their ShopStaff.role is only SHOP_COUNTER", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(async (shopId: string) =>
        shopId === "shop-a" ? UserRole.SHOP_MANAGER : UserRole.SHOP_COUNTER,
      ),
    };
    const guard = new RolesGuard(
      buildReflector([UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER]) as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );

    const context = buildContext({ printerId: "printer-in-shop-b" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("falls back to the account-level User.role when the route declares no shop scope", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(),
    };
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === ROLES_KEY) return [UserRole.SHOP_COUNTER];
        return undefined; // no shop-scope metadata on this route
      }),
    };
    const guard = new RolesGuard(
      reflector as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );

    const context = buildContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(shopMembership.getEffectiveRole).not.toHaveBeenCalled();
  });
});
