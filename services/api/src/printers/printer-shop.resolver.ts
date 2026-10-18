import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ResourceScope, ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class PrinterShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(printerId: string): Promise<string | null> {
    return (await this.resolveScope(printerId))?.shopId ?? null;
  }

  /** Step 3: a printer belongs to the branch its PC is at. */
  async resolveScope(printerId: string): Promise<ResourceScope | null> {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
      select: { shopId: true, branchId: true },
    });
    return printer ? { shopId: printer.shopId, branchId: printer.branchId } : null;
  }
}
