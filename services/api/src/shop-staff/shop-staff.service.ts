import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ShopStaffStatus, UserRole, type Prisma, type ShopStaff } from "@prisma/client";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import type { Page } from "@print-automated/types";
import type { AddShopStaffInput, ListShopStaffQueryInput } from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { ilike } from "../common/search.js";

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

/** 23.6: one row of `GET /shop/staff` -- a member plus the person's name and email
 * (never a credential). */
export interface ShopStaffListItem extends ShopStaffMemberResponse {
  name: string;
  email: string;
  createdAt: Date;
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

  /** 23.6: the business's people. REMOVED members are hidden unless asked for
   * (`status=REMOVED`); newest first is NOT used -- alphabetical by name is the natural
   * roster order. Always a page (limit 1-100, default 50). */
  async listStaff(
    actorId: string,
    query: ListShopStaffQueryInput,
  ): Promise<Page<ShopStaffListItem>> {
    await this.assertMember(query.shopId, actorId);
    const where: Prisma.ShopStaffWhereInput = {
      shopId: query.shopId,
      status: query.status ?? { not: ShopStaffStatus.REMOVED },
      ...(query.role ? { role: query.role } : {}),
      ...(query.q
        ? {
            user: {
              OR: [{ name: ilike(query.q) }, { email: ilike(query.q) }],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shopStaff.findMany({
        where,
        orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
        include: { user: { select: { name: true, email: true } } },
      }),
      this.prisma.shopStaff.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        shopId: row.shopId,
        userId: row.userId,
        role: row.role,
        status: row.status,
        name: row.user.name,
        email: row.user.email,
        createdAt: row.createdAt,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** §54/16.4: upsert on `(shopId, userId)` -- adding someone already
   * staffing this shop changes their role (and reactivates them if they
   * were REMOVED) rather than erroring, the same "claim, or find what's
   * already there" idempotency shape refund.service.ts's own upsert
   * already established for this codebase. */
  async addStaff(actorId: string, input: AddShopStaffInput): Promise<ShopStaffMemberResponse> {
    await this.assertMember(input.shopId, actorId);
    await this.assertCanGrantRole(input.shopId, actorId, input.role);

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
   * left with nobody able to manage it.
   *
   * Code review finding (16.6 review): the last-owner check and the
   * write that acts on it must happen under the SAME lock, not as a
   * separate `count()` read followed by an unguarded `update()` --
   * otherwise two concurrent removals of two different owners at the
   * same shop can each read "the other owner still exists", both pass,
   * and both commit, leaving zero owners. Fixed the same way
   * order-state-machine.ts's own `SELECT ... FOR UPDATE` prevents the
   * identical class of race on order_status: lock every active
   * SHOP_OWNER row at this shop first, inside a transaction, so a
   * second concurrent removal/demotion at the same shop blocks until
   * the first one commits and re-reads the post-commit state. */
  async removeStaff(shopStaffId: string, actorId: string | null): Promise<void> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    await this.prisma.$transaction(async (tx) => {
      if (membership.role === UserRole.SHOP_OWNER && membership.status === ShopStaffStatus.ACTIVE) {
        await this.assertNotLastOwnerLocked(tx, membership.shopId, membership.id);
      }

      await tx.shopStaff.update({
        where: { id: shopStaffId },
        data: { status: ShopStaffStatus.REMOVED },
      });
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_REMOVED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: { shopId: membership.shopId, userId: membership.userId, role: membership.role },
    });
  }

  /** Same last-owner safety net as `removeStaff` (same locked-transaction
   * fix -- see its own comment), plus the same "granting SHOP_OWNER
   * requires already being SHOP_OWNER" check `addStaff` applies. */
  async changeRole(
    shopStaffId: string,
    newRole: UserRole,
    actorId: string | null,
  ): Promise<ShopStaffMemberResponse> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }
    await this.assertCanGrantRole(membership.shopId, actorId, newRole);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (
        membership.role === UserRole.SHOP_OWNER &&
        newRole !== UserRole.SHOP_OWNER &&
        membership.status === ShopStaffStatus.ACTIVE
      ) {
        await this.assertNotLastOwnerLocked(tx, membership.shopId, membership.id);
      }

      return tx.shopStaff.update({
        where: { id: shopStaffId },
        data: { role: newRole },
      });
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

  /** Code review finding (16.6 review): `MANAGE_USERS` (held by both
   * SHOP_MANAGER and SHOP_OWNER) let a SHOP_MANAGER -- who deliberately
   * lacks MANAGE_SETTINGS -- grant themselves or anyone else SHOP_OWNER
   * via `addStaff`/`changeRole`, bypassing the owner/manager boundary
   * entirely. Granting or changing a membership TO SHOP_OWNER now
   * additionally requires the ACTOR to already be an active SHOP_OWNER
   * at this same shop -- a permission alone (MANAGE_USERS) is not
   * enough to hand out the platform's highest per-shop role; only an
   * existing holder of that role can extend it. actorId is nullable on
   * the shared type (system-driven calls elsewhere in this codebase
   * pass null), but every real caller of addStaff/changeRole is an
   * authenticated controller route, so a null actor here can never
   * legitimately claim to already be an owner. */
  private async assertCanGrantRole(
    shopId: string,
    actorId: string | null,
    targetRole: UserRole,
  ): Promise<void> {
    if (targetRole !== UserRole.SHOP_OWNER) {
      return;
    }
    const actorRole = actorId ? await this.shopMembership.getEffectiveRole(shopId, actorId) : null;
    if (actorRole !== UserRole.SHOP_OWNER) {
      throw new ForbiddenException("Only an existing owner can grant the SHOP_OWNER role.");
    }
  }

  /** Must run inside the SAME transaction as the write it's guarding --
   * see removeStaff/changeRole's own comments. Locks every active
   * SHOP_OWNER row at this shop (not just the one being acted on) so
   * two concurrent calls targeting two DIFFERENT owner rows at the same
   * shop still serialize against each other: whichever transaction's
   * `FOR UPDATE` runs first holds the lock until it commits, and the
   * second one blocks until then and re-reads the true post-commit
   * count, rather than both reading a stale "someone else is still an
   * owner" snapshot concurrently. */
  private async assertNotLastOwnerLocked(
    tx: Prisma.TransactionClient,
    shopId: string,
    excludingShopStaffId: string,
  ): Promise<void> {
    const lockedOwnerRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM shop_staff
      WHERE shop_id = ${shopId} AND role = 'SHOP_OWNER' AND status = 'ACTIVE'
      FOR UPDATE
    `;
    const remainingOwners = lockedOwnerRows.filter((row) => row.id !== excludingShopStaffId).length;
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
