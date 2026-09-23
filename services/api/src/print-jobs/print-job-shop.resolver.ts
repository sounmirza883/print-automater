import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

/** Mirrors OrderShopResolver exactly -- the same one-column lookup
 * shape, this time on `print_jobs.shop_id`, which 8.1's own migration
 * comment already anticipated ("denormalized... 8.2's shop-scoped
 * queries need it directly indexed"). */
@Injectable()
export class PrintJobShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(printJobId: string): Promise<string | null> {
    const job = await this.prisma.printJob.findUnique({
      where: { id: printJobId },
      select: { shopId: true },
    });
    return job?.shopId ?? null;
  }
}
