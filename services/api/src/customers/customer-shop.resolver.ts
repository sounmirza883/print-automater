import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class CustomerShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(customerId: string): Promise<string | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { shopId: true },
    });
    return customer?.shopId ?? null;
  }
}
