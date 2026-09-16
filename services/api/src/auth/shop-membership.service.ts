import { Injectable } from "@nestjs/common";
import { ShopStaffStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";

/** §81/§82's actual membership check, factored out of ShopScopeGuard so
 * a route with no single resource to resolve a shop id from (8.2's
 * `GET /shop/orders` list, filtered by a caller-supplied `shopId`
 * query param rather than a route param) can run the identical check
 * instead of a second, easier-to-desync copy of it. */
@Injectable()
export class ShopMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async isActiveStaff(shopId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.shopStaff.findFirst({
      where: { shopId, userId, status: ShopStaffStatus.ACTIVE },
    });
    return membership !== null;
  }
}
