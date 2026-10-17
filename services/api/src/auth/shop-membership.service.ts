import { Injectable } from "@nestjs/common";
import { ShopStaffStatus, type UserRole } from "@prisma/client";
import { PrismaService, effectivePermissions } from "@print-automated/backend-shared";
import type { Permission } from "@print-automated/types";

/** §81/§82's actual membership check, factored out of ShopScopeGuard so
 * a route with no single resource to resolve a shop id from (8.2's
 * `GET /shop/orders` list, filtered by a caller-supplied `shopId`
 * query param rather than a route param) can run the identical check
 * instead of a second, easier-to-desync copy of it. */
@Injectable()
export class ShopMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async isActiveStaff(shopId: string, userId: string): Promise<boolean> {
    const membership = await this.prisma.shopStaff.findFirst({
      where: { shopId, userId, status: ShopStaffStatus.ACTIVE },
    });
    return membership !== null;
  }

  /** §46/16.1: `ShopStaff.role` is the *effective* role for anything
   * done at this specific shop -- the same person can be, per the
   * schema's own comment, SHOP_MANAGER at one shop and SHOP_COUNTER
   * (or not staff at all) at another. Returns null for no active
   * membership, letting callers fall back to the account-level
   * `User.role` for non-shop-scoped routes (auth, admin) rather than
   * conflating "no shop role" with any particular role. */
  async getEffectiveRole(shopId: string, userId: string): Promise<UserRole | null> {
    const membership = await this.prisma.shopStaff.findFirst({
      where: { shopId, userId, status: ShopStaffStatus.ACTIVE },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  /** The member's role AND what they may actually do at this shop: the role's defaults plus the
   * person's own overrides (`effectivePermissions`). Null for no active membership. Prefer this
   * over `ROLE_PERMISSIONS[role]` anywhere a member's permissions are decided. */
  async getAccess(shopId: string, userId: string): Promise<MemberAccess | null> {
    const membership = await this.prisma.shopStaff.findFirst({
      where: { shopId, userId, status: ShopStaffStatus.ACTIVE },
      select: { role: true, extraPermissions: true, removedPermissions: true },
    });
    if (!membership) {
      return null;
    }
    return {
      role: membership.role,
      permissions: effectivePermissions(membership.role, membership),
    };
  }
}

export interface MemberAccess {
  role: UserRole;
  permissions: Permission[];
}
