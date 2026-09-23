import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ShopStaffStatus, UserRole, type ShopStaff } from "@prisma/client";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import type { AddShopStaffInput } from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

export interface MyShopMembership {
  id: string;
  name: string;
  /** §46/16.1: `ShopStaff.role` at THIS shop -- the effective,
   * per-membership role, not the account-level `User.role` from the
   * JWT. The Shop app needs this to know what the caller can actually
   * do at whichever shop it's currently operating for. */
  role: UserRole;
}

export interface ShopStaffMemberResponse {
  id: string;
  shopId: string;
  userId: string;
  role: UserRole;
  status: ShopStaffStatus;
}

/** The Shop app (3.4) has no notion of "which shop am I" anywhere --
 * the JWT carries only `id`/`role` (§9's account-level role), and
 * nothing in Phase 8's own text calls for a dedicated lookup. Without
 * this, 8.5-8.9's screens would have no `shopId` to pass to any of
 * 8.2/8.3/8.4's own shopId-scoped endpoints. Deliberately a plain list,
 * not a single "the" shop -- shop_staff already allows one user to
 * staff more than one shop; a multi-shop picker is out of scope for
 * this MVP (no such UI exists anywhere in the PRD), so the caller
 * (shop-auth-provider.tsx) picks the first when there's more than one.
 *
 * §54/16.4: add/remove/change-role work on an EXISTING `User` id --
 * there's no invite-by-email-for-a-not-yet-registered-person flow in
 * this sub-phase. That overlaps with auth/registration (who creates the
 * account, how they set a password, whether an invite token is a
 * distinct kind of credential) -- concerns this phase doesn't own, and
 * the PRD's own §54 text doesn't insist on it either. TODO (out of this
 * sub-phase's scope): a real "invite a new person by email" flow that
 * creates the User account too, once auth/registration decides how it
 * wants unsolicited-account-creation-by-someone-else to work. */
@Injectable()
export class ShopStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  async myShops(userId: string): Promise<MyShopMembership[]> {
    const memberships = await this.prisma.shopStaff.findMany({
      where: { userId, status: ShopStaffStatus.ACTIVE },
      include: { shop: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((membership) => ({
      id: membership.shop.id,
      name: membership.shop.name,
      role: membership.role,
    }));
  }

  /** §54/16.4: upsert on `(shopId, userId)` -- adding someone already
   * staffing this shop changes their role (and reactivates them if they
   * were REMOVED) rather than erroring, the same "claim, or find what's
   * already there" idempotency shape refund.service.ts's own upsert
   * already established for this codebase. */
  async addStaff(actorId: string, input: AddShopStaffInput): Promise<ShopStaffMemberResponse> {
    await this.assertMember(input.shopId, actorId);

    const targetUser = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!targetUser) {
      throw new NotFoundException("No such user.");
    }

    const membership = await this.prisma.shopStaff.upsert({
      where: { shopId_userId: { shopId: input.shopId, userId: input.userId } },
      create: {
        shopId: input.shopId,
        userId: input.userId,
        role: input.role,
        status: ShopStaffStatus.ACTIVE,
      },
      update: { role: input.role, status: ShopStaffStatus.ACTIVE },
    });

    // §45/16.6: shop-staff changes previously wrote no audit row at all.
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_ADDED,
      resourceType: "shop_staff",
      resourceId: membership.id,
      metadata: { shopId: input.shopId, userId: input.userId, role: input.role },
    });

    return this.toResponse(membership);
  }

  /** Soft delete (§54's own `ShopStaffStatus.REMOVED`), never a hard
   * delete -- the row is the audit trail's own subject in 16.6. Blocks
   * removing a shop's last active SHOP_OWNER so a shop can never be
   * left with nobody able to manage it. */
  async removeStaff(shopStaffId: string, actorId: string | null): Promise<void> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    if (membership.role === UserRole.SHOP_OWNER && membership.status === ShopStaffStatus.ACTIVE) {
      await this.assertNotLastOwner(membership.shopId, membership.id);
    }

    await this.prisma.shopStaff.update({
      where: { id: shopStaffId },
      data: { status: ShopStaffStatus.REMOVED },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_REMOVED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: { shopId: membership.shopId, userId: membership.userId, role: membership.role },
    });
  }

  /** Same last-owner safety net as `removeStaff` -- demoting the last
   * SHOP_OWNER away from SHOP_OWNER is exactly as dangerous as removing
   * them outright. */
  async changeRole(
    shopStaffId: string,
    newRole: UserRole,
    actorId: string | null,
  ): Promise<ShopStaffMemberResponse> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    if (
      membership.role === UserRole.SHOP_OWNER &&
      newRole !== UserRole.SHOP_OWNER &&
      membership.status === ShopStaffStatus.ACTIVE
    ) {
      await this.assertNotLastOwner(membership.shopId, membership.id);
    }

    const updated = await this.prisma.shopStaff.update({
      where: { id: shopStaffId },
      data: { role: newRole },
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_ROLE_CHANGED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: {
        shopId: membership.shopId,
        userId: membership.userId,
        from: membership.role,
        to: newRole,
      },
    });

    return this.toResponse(updated);
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
  }

  private async assertNotLastOwner(shopId: string, excludingShopStaffId: string): Promise<void> {
    const remainingOwners = await this.prisma.shopStaff.count({
      where: {
        shopId,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
        id: { not: excludingShopStaffId },
      },
    });
    if (remainingOwners === 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "CANNOT_REMOVE_LAST_OWNER",
        "A shop must always have at least one active owner.",
        false,
      );
    }
  }

  private toResponse(membership: ShopStaff): ShopStaffMemberResponse {
    return {
      id: membership.id,
      shopId: membership.shopId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
    };
  }
}
