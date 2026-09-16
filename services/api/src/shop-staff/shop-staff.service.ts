import { Injectable } from "@nestjs/common";
import { ShopStaffStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";

export interface MyShopMembership {
  id: string;
  name: string;
}

/** The Shop app (3.4) has no notion of "which shop am I" anywhere --
 * the JWT carries only `id`/`role` (§9's account-level role), and
 * nothing in Phase 8's own text calls for a dedicated lookup. Without
 * this, 8.5-8.9's screens would have no `shopId` to pass to any of
 * 8.2/8.3/8.4's own shopId-scoped endpoints. Deliberately a plain list,
 * not a single "the" shop -- shop_staff already allows one user to
 * staff more than one shop; a multi-shop picker is out of scope for
 * this MVP (no such UI exists anywhere in the PRD), so the caller
 * (shop-auth-provider.tsx) picks the first when there's more than one. */
@Injectable()
export class ShopStaffService {
  constructor(private readonly prisma: PrismaService) {}

  async myShops(userId: string): Promise<MyShopMembership[]> {
    const memberships = await this.prisma.shopStaff.findMany({
      where: { userId, status: ShopStaffStatus.ACTIVE },
      include: { shop: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((membership) => ({
      id: membership.shop.id,
      name: membership.shop.name,
    }));
  }
}
