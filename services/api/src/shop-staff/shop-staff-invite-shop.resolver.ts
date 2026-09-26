import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

/** 23.15: `:id` on the cancel-invitation route is the `ShopStaffInvite` row id. */
@Injectable()
export class ShopStaffInviteShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(inviteId: string): Promise<string | null> {
    const invite = await this.prisma.shopStaffInvite.findUnique({
      where: { id: inviteId },
      select: { shopId: true },
    });
    return invite?.shopId ?? null;
  }
}
