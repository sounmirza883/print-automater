import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { effectivePermissions } from "@print-automated/backend-shared";
import { Permission } from "@print-automated/types";
import { lastValueFrom, of } from "rxjs";
import type { ShopMembershipService } from "../auth/shop-membership.service.js";
import { SHOP_SCOPE_FIELD_KEY } from "../auth/shop-scoped.decorator.js";
import { DeliveryRedactionInterceptor } from "./delivery-redaction.interceptor.js";

const delivery = { address: "12 Main St", trackingNumber: "T1", feeMinor: 100 };

describe("DeliveryRedactionInterceptor reads the person's own access", () => {
  async function run(
    overrides: { removedPermissions?: string[]; extraPermissions?: string[] },
    role: UserRole,
  ) {
    const request = { user: { id: "u1", role }, query: { shopId: "shop-1" } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => (): void => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === SHOP_SCOPE_FIELD_KEY ? { source: "query", field: "shopId" } : undefined,
      ),
    };
    const membership: Pick<ShopMembershipService, "getAccess"> = {
      getAccess: jest.fn(async () => ({
        role,
        permissions: effectivePermissions(role, overrides),
      })),
    };
    const interceptor = new DeliveryRedactionInterceptor(
      reflector as never,
      { get: jest.fn() } as never,
      membership as ShopMembershipService,
    );
    const handler: CallHandler = { handle: () => of({ ...delivery }) };
    return lastValueFrom(interceptor.intercept(context, handler)) as Promise<{
      address: string | null;
    }>;
  }

  it("shows the address to a manager who still holds MANAGE_DELIVERY", async () => {
    expect((await run({}, UserRole.SHOP_MANAGER)).address).toBe("12 Main St");
  });

  it("hides the address from a manager whose MANAGE_DELIVERY was taken away", async () => {
    const result = await run(
      { removedPermissions: [Permission.MANAGE_DELIVERY] },
      UserRole.SHOP_MANAGER,
    );
    expect(result.address).toBeNull();
  });

  it("shows the address to an operator who was granted MANAGE_DELIVERY", async () => {
    const result = await run({ extraPermissions: [Permission.MANAGE_DELIVERY] }, UserRole.OPERATOR);
    expect(result.address).toBe("12 Main St");
  });
});
