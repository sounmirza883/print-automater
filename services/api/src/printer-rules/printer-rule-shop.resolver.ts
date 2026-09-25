import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

@Injectable()
export class PrinterRuleShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(ruleId: string): Promise<string | null> {
    const row = await this.prisma.printerAutomationRule.findUnique({
      where: { id: ruleId },
      select: { shopId: true },
    });
    return row?.shopId ?? null;
  }
}
