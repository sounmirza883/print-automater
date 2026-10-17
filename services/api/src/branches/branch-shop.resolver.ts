import { Injectable } from "@nestjs/common";
import { PrismaService } from "@print-automated/backend-shared";
import type { ShopResourceResolver } from "../auth/shop-scope.interfaces.js";

/** `:id` on the branch routes is the `Branch` row id; the owning business is the tenant. */
@Injectable()
export class BranchShopResolver implements ShopResourceResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveShopId(branchId: string): Promise<string | null> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { shopId: true },
    });
    return branch?.shopId ?? null;
  }
}
