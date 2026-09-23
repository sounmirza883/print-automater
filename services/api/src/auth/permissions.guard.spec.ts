import { ForbiddenException, type ExecutionContext, type Type } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Permission } from "@print-automated/types";
import { PermissionsGuard } from "./permissions.guard.js";
import { PERMISSION_KEY } from "./require-permission.decorator.js";
import { SHOP_SCOPE_PARAM_KEY, SHOP_SCOPE_RESOLVER_KEY } from "./shop-scoped.decorator.js";
import type { ShopResourceResolver } from "./shop-scope.interfaces.js";
import type { ShopMembershipService } from "./shop-membership.service.js";

class FakePrinterShopResolver implements ShopResourceResolver {
  async resolveShopId(printerId: string): Promise<string | null> {
    return printerId === "printer-in-shop-a" ? "shop-a" : "shop-b";
  }
}

/** §47/16.2's own mechanism-level Done-when: `@RequirePermission(X)`
 * blocks a role that lacks X, using the EFFECTIVE (16.1) role. 16.3
 * then wires this onto a real production route (printers.controller.ts)
 * for the full HTTP-level 403 proof; this suite proves the guard's own
 * logic in isolation first, the same split roles.guard.spec.ts already
 * used for RolesGuard. */
describe("PermissionsGuard (§47/16.2)", () => {
  function buildContext(role: UserRole, params: Record<string, string>): ExecutionContext {
    const request = { user: { id: "user-1", role }, params };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => (): void => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  function buildReflector(requiredPermission: Permission | undefined): {
    getAllAndOverride: jest.Mock;
  } {
    return {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === PERMISSION_KEY) return requiredPermission;
        if (key === SHOP_SCOPE_PARAM_KEY) return "printerId";
        if (key === SHOP_SCOPE_RESOLVER_KEY) return FakePrinterShopResolver as Type<unknown>;
        return undefined;
      }),
    };
  }

  function buildModuleRef(): { get: jest.Mock } {
    return { get: jest.fn(() => new FakePrinterShopResolver()) };
  }

  it("allows a role that has the required permission", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(async () => UserRole.SHOP_MANAGER),
    };
    const guard = new PermissionsGuard(
      buildReflector(Permission.MANAGE_PRINTERS) as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );
    const context = buildContext(UserRole.SHOP_COUNTER, { printerId: "printer-in-shop-a" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("blocks a role that lacks the required permission (SHOP_COUNTER has no MANAGE_PRINTERS)", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(async () => UserRole.SHOP_COUNTER),
    };
    const guard = new PermissionsGuard(
      buildReflector(Permission.MANAGE_PRINTERS) as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );
    const context = buildContext(UserRole.SHOP_COUNTER, { printerId: "printer-in-shop-a" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("passes through routes with no @RequirePermission() metadata", async () => {
    const shopMembership: Pick<ShopMembershipService, "getEffectiveRole"> = {
      getEffectiveRole: jest.fn(),
    };
    const guard = new PermissionsGuard(
      buildReflector(undefined) as never,
      buildModuleRef() as never,
      shopMembership as ShopMembershipService,
    );
    const context = buildContext(UserRole.SHOP_COUNTER, {});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(shopMembership.getEffectiveRole).not.toHaveBeenCalled();
  });
});
