import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ResourceScope, ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

/** Every future shop-scoped print_jobs/printers resolver looks the
 * same shape -- a one-column lookup on that table's own `shop_id`. */
@Injectable()
export class OrderShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(orderId: string): Promise<string | null> {
    return (await this.resolveScope(orderId))?.shopId ?? null;
  }

  /** Step 3: an order belongs to the branch it was placed at. */
  async resolveScope(orderId: string): Promise<ResourceScope | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { shopId: true, branchId: true },
    });
    return order ? { shopId: order.shopId, branchId: order.branchId } : null;
  }
}
