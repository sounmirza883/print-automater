import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class PrinterShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(printerId: string): Promise<string | null> {
    const printer = await this.prisma.printer.findUnique({
      where: { id: printerId },
      select: { shopId: true },
    });
    return printer?.shopId ?? null;
  }
}
