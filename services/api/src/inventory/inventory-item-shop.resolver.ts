import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class InventoryItemShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(itemId: string): Promise<string | null> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: itemId },
      select: { shopId: true },
    });
    return item?.shopId ?? null;
  }
}
