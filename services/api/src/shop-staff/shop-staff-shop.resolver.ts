import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

/** §54/16.4: `:id` on remove/change-role routes is the `ShopStaff` row
 * id, not a userId -- one person can have more than one row (one per
 * shop they staff), so acting on "the right shop's membership" has to
 * mean the specific row, not the person. */
@Injectable()
export class ShopStaffShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(shopStaffId: string): Promise<string | null> {
    const membership = await this.prisma.shopStaff.findUnique({
      where: { id: shopStaffId },
      select: { shopId: true },
    });
    return membership?.shopId ?? null;
  }
}
