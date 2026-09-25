import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class SupplierShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(supplierId: string): Promise<string | null> {
    const row = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { shopId: true },
    });
    return row?.shopId ?? null;
  }
}

@Injectable()
export class SupplierProductShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(linkId: string): Promise<string | null> {
    const row = await this.prisma.supplierProduct.findUnique({
      where: { id: linkId },
      select: { shopId: true },
    });
    return row?.shopId ?? null;
  }
}
