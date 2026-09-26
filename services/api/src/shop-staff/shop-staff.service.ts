import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ShopStaffStatus, UserRole, type Prisma, type ShopStaff } from "@prisma/client";
import {
  AppException,
  AuditService,
  PrismaService,
  ROLE_PERMISSIONS,
} from "@print-automated/backend-shared";
import type { Page, Permission } from "@print-automated/types";
import type {
  ListShopStaffQueryInput,
  StaffDirectoryQueryInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { ilike } from "../common/search.js";
import { roleRank } from "./role-rank.js";

export interface MyShopMembership {
  id: string;
  name: string;
  /** §46/16.1: `ShopStaff.role` at THIS shop -- the effective,
   * per-membership role, not the account-level `User.role` from the
   * JWT. The Shop app needs this to know what the caller can actually
   * do at whichever shop it's currently operating for. */
  role: UserRole;
  /** 23.15: what `role` may do at THIS business, straight from ROLE_PERMISSIONS (the same data
   * PermissionsGuard enforces), so a client never mirrors the catalog. Display only: the
   * server still authorizes every request. */
  permissions: Permission[];
}

/** 23.15: `GET /shop/staff/me`. */
export interface MyShopsResponse {
  user: { id: string; name: string; email: string };
  shops: MyShopMembership[];
}

/** 23.15: one row of the minimal staff directory. */
export interface StaffDirectoryItem {
  userId: string;
  name: string;
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
 * this sub-phase. */
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
      permissions: [...(ROLE_PERMISSIONS[membership.role] ?? [])],
    }));
  }

  /** 23.15: the signed-in person plus every business they staff, with the effective permission
   * list per membership. */
  async me(userId: string): Promise<MyShopsResponse> {
    const [user, shops] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true },
      }),
      this.myShops(userId),
    ]);
    return { user, shops };
  }

  /** 23.15: id + display name of the business's ACTIVE members, alphabetical, paged. Needs only
   * VIEW_STAFF_DIRECTORY (every staff role): no email, no role, no status. Tenant scope is the
   * caller's own active membership at `shopId`. */
  async directory(
    actorId: string,
    query: StaffDirectoryQueryInput,
  ): Promise<Page<StaffDirectoryItem>> {
    await this.assertMember(query.shopId, actorId);
    const where: Prisma.ShopStaffWhereInput = {
      shopId: query.shopId,
      status: ShopStaffStatus.ACTIVE,
      ...(query.role ? { role: query.role } : {}),
      ...(query.q ? { user: { name: ilike(query.q) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.shopStaff.findMany({
        where,
        orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
        select: { userId: true, user: { select: { name: true } } },
      }),
      this.prisma.shopStaff.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({ userId: row.userId, name: row.user.name })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
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
  async addStaff(
    actorId: string,
    input: { shopId: string; userId: string; role: UserRole },
  ): Promise<ShopStaffMemberResponse> {
    await this.assertMember(input.shopId, actorId);

    const targetUser = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!targetUser) {
      throw new NotFoundException("No such user.");
    }

    // 23.12: the upsert can also demote/reactivate an EXISTING membership, so it is held
    // to the same rank rules as changeRole/removeStaff, decided under the same row locks.
    const membership = await this.prisma.$transaction(async (tx) => {
      await this.authorizeMutationLocked(tx, {
        shopId: input.shopId,
        actorId,
        targetMembershipId: null,
        targetUserId: input.userId,
        newRole: input.role,
        removing: false,
      });
      return tx.shopStaff.upsert({
        where: { shopId_userId: { shopId: input.shopId, userId: input.userId } },
        create: {
          shopId: input.shopId,
          userId: input.userId,
          role: input.role,
          status: ShopStaffStatus.ACTIVE,
        },
        update: { role: input.role, status: ShopStaffStatus.ACTIVE },
      });
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
   * delete -- the row is the audit trail's own subject in 16.6. Authority and the
   * last-owner rule are decided under row locks by `authorizeMutationLocked` (see it):
   * only an owner can remove an owner, and a shop can never be left with nobody able
   * to manage it (the 16.6 review's race fix lives in that same lock). */
  async removeStaff(shopStaffId: string, actorId: string): Promise<void> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    const before = await this.prisma.$transaction(async (tx) => {
      const target = await this.authorizeMutationLocked(tx, {
        shopId: membership.shopId,
        actorId,
        targetMembershipId: membership.id,
        targetUserId: membership.userId,
        removing: true,
      });
      await tx.shopStaff.update({
        where: { id: shopStaffId },
        data: { status: ShopStaffStatus.REMOVED },
      });
      return target;
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_REMOVED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: { shopId: membership.shopId, userId: membership.userId, role: before.role },
    });
  }

  /** Same locked authority + last-owner checks as `removeStaff` (see its comment). */
  async changeRole(
    shopStaffId: string,
    newRole: UserRole,
    actorId: string,
  ): Promise<ShopStaffMemberResponse> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    const { updated, before } = await this.prisma.$transaction(async (tx) => {
      const target = await this.authorizeMutationLocked(tx, {
        shopId: membership.shopId,
        actorId,
        targetMembershipId: membership.id,
        targetUserId: membership.userId,
        newRole,
        removing: false,
      });
      const row = await tx.shopStaff.update({
        where: { id: shopStaffId },
        data: { role: newRole },
      });
      return { updated: row, before: target };
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_ROLE_CHANGED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: {
        shopId: membership.shopId,
        userId: membership.userId,
        from: before.role,
        to: newRole,
      },
    });

    return this.toResponse(updated);
  }

  /** 23.15: the same authority decision an add would face, without adding anyone -- used
   * before sending an invitation, so nobody can invite above their own rank. */
  async assertMayGrant(actorId: string, shopId: string, role: UserRole): Promise<void> {
    await this.assertMember(shopId, actorId);
    await this.prisma.$transaction(async (tx) => {
      await this.authorizeMutationLocked(tx, {
        shopId,
        actorId,
        targetMembershipId: null,
        targetUserId: "",
        newRole: role,
        removing: false,
      });
    });
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, userId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
  }

  /** 23.12 (supersedes 16.6's owner-grant-only check). One authority decision for every
   * membership mutation (add-upsert, change role, remove), taken INSIDE the caller's
   * transaction on rows locked FOR UPDATE, so it can never act on a stale role:
   *   - the actor must hold an ACTIVE membership at this shop, read under the lock
   *     (a manager demoted a moment ago is refused, not honoured on a stale role);
   *   - a non-owner cannot touch a member whose CURRENT role outranks theirs (so only an
   *     owner can demote or remove an owner) and cannot grant a role above their own
   *     (so only an owner can grant SHOP_OWNER, and nobody escalates themselves);
   *   - the last active owner can never be demoted or removed (409), checked AFTER
   *     authority so an unauthorised caller gets 403, not a hint about owner counts.
   * Rank: SHOP_OWNER > SHOP_MANAGER > every other role. A manager may manage other
   * managers (equal rank) and anyone below; self-demotion/self-removal is allowed.
   *
   * Locking: ONE statement locks the actor's row, the target's row and every active
   * owner row, `ORDER BY id`, so concurrent mutations at the same shop take the locks in
   * the same order (no deadlock) and the loser re-reads the winner's committed state.
   * Returns the target's locked (pre-change) row (a placeholder row with an empty id when the add creates a brand-new member). */
  private async authorizeMutationLocked(
    tx: Prisma.TransactionClient,
    params: {
      shopId: string;
      actorId: string;
      targetMembershipId: string | null;
      targetUserId: string;
      newRole?: UserRole;
      removing: boolean;
    },
  ): Promise<{ id: string; role: UserRole; status: ShopStaffStatus }> {
    const { shopId, actorId, targetMembershipId, targetUserId, newRole, removing } = params;
    const rows = await tx.$queryRaw<
      Array<{ id: string; user_id: string; role: UserRole; status: ShopStaffStatus }>
    >`
      SELECT id, user_id, role::text AS role, status::text AS status FROM shop_staff
      WHERE shop_id = ${shopId}
        AND (
          user_id = ${actorId}
          OR user_id = ${targetUserId}
          OR id = ${targetMembershipId ?? ""}
          OR (role = 'SHOP_OWNER' AND status = 'ACTIVE')
        )
      ORDER BY id
      FOR UPDATE
    `;

    const actor = rows.find((row) => row.user_id === actorId && row.status === "ACTIVE");
    if (!actor) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
    const actorRank = roleRank(actor.role);

    const target = rows.find((row) => row.user_id === targetUserId) ?? null;
    if (targetMembershipId !== null && !target) {
      throw new NotFoundException("No such shop staff membership.");
    }
    if (target && roleRank(target.role) > actorRank) {
      throw new ForbiddenException(
        target.role === UserRole.SHOP_OWNER
          ? "Only an owner can change or remove an owner."
          : "You cannot change or remove a member whose role outranks yours.",
      );
    }
    if (newRole && roleRank(newRole) > actorRank) {
      throw new ForbiddenException(
        newRole === UserRole.SHOP_OWNER
          ? "Only an existing owner can grant the SHOP_OWNER role."
          : "You cannot grant a role above your own.",
      );
    }

    if (
      target &&
      target.role === UserRole.SHOP_OWNER &&
      target.status === "ACTIVE" &&
      (removing || newRole !== UserRole.SHOP_OWNER)
    ) {
      const remainingOwners = rows.filter(
        (row) =>
          row.id !== target.id && row.role === UserRole.SHOP_OWNER && row.status === "ACTIVE",
      ).length;
      if (remainingOwners === 0) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "CANNOT_REMOVE_LAST_OWNER",
          "A shop must always have at least one active owner.",
          false,
        );
      }
    }

    return target ?? { id: "", role: UserRole.CUSTOMER, status: ShopStaffStatus.ACTIVE };
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
