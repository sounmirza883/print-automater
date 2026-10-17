import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { ShopStaffStatus, UserRole, type Prisma, type ShopStaff } from "@prisma/client";
import {
  AppException,
  AuditService,
  OWNER_ONLY_PERMISSIONS,
  PrismaService,
  type AccessOverrides,
  ROLE_PERMISSIONS,
  diffFromRole,
  effectivePermissions,
  normalizePermissions,
} from "@print-automated/backend-shared";
import { Permission, type Page } from "@print-automated/types";
import type {
  ListShopStaffQueryInput,
  StaffDirectoryQueryInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { ilike } from "../common/search.js";
import { resolveBranchScope } from "./branch-scope.js";
import { roleRank } from "./role-rank.js";

export interface MyShopMembership {
  id: string;
  name: string;
  /** §46/16.1: `ShopStaff.role` at THIS shop -- the effective,
   * per-membership role, not the account-level `User.role` from the
   * JWT. The Shop app needs this to know what the caller can actually
   * do at whichever shop it's currently operating for. */
  role: UserRole;
  /** 23.15: what this person may do at THIS business: the role's ROLE_PERMISSIONS defaults plus
   * their own overrides (the same data PermissionsGuard enforces), so a client never mirrors
   * the catalog. Display only: the
   * server still authorizes every request. */
  permissions: Permission[];
  /** The branch this person works at here; null = "All branches". */
  branchId: string | null;
  branchName: string | null;
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
  /** Where they work; null = "All branches". */
  branchId: string | null;
}

/** What `authorizeMutationLocked` decided: the target's locked (pre-change) row, and what the
 * actor themselves may hand out. The target is a placeholder with an empty id when an add
 * creates a brand-new member. */
interface LockedAuthority {
  target: {
    id: string;
    role: UserRole;
    status: ShopStaffStatus;
    extraPermissions: string[];
    removedPermissions: string[];
    branchId: string | null;
  };
  /** The actor's own role and branch, read under the same lock. */
  actor: { role: UserRole; branchId: string | null };
  actorPermissions: Permission[];
}

/** `PATCH /shop/staff/:id` response: the member plus what they can now do. */
export interface ShopStaffAccessResponse extends ShopStaffMemberResponse {
  permissions: Permission[];
}

/** 23.6: one row of `GET /shop/staff` -- a member plus the person's name and email
 * (never a credential). */
export interface ShopStaffListItem extends ShopStaffMemberResponse {
  name: string;
  email: string;
  createdAt: Date;
  /** What this person may do now: role defaults plus their own overrides. */
  permissions: Permission[];
  /** What their role alone would give them, so a client never keeps a copy of that table. */
  defaultPermissions: Permission[];
  /** The branch this person works at; null = "All branches". */
  branchId: string | null;
  branchName: string | null;
  /** True when the person's access differs from their role's defaults. */
  customised: boolean;
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
      include: {
        shop: { select: { id: true, name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((membership) => ({
      id: membership.shop.id,
      name: membership.shop.name,
      role: membership.role,
      permissions: effectivePermissions(membership.role, membership),
      branchId: membership.branchId,
      branchName: membership.branch?.name ?? null,
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
    const actor = await this.shopMembership.getAccess(query.shopId, actorId);
    if (!actor) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
    // 23.18: the role is never returned, but filtering by it would still let any staff role
    // list exactly who the owners and managers are. That needs MANAGE_USERS.
    if (
      (query.role === UserRole.SHOP_OWNER || query.role === UserRole.SHOP_MANAGER) &&
      !actor.permissions.includes(Permission.MANAGE_USERS)
    ) {
      throw new ForbiddenException("You cannot filter the staff directory by that role.");
    }
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
    const access = await this.shopMembership.getAccess(query.shopId, actorId);
    if (!access) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
    // A branch-bound person only ever sees their own branch's people.
    const branchId = resolveBranchScope(access.branchId, query.branchId);
    const where: Prisma.ShopStaffWhereInput = {
      shopId: query.shopId,
      status: query.status ?? { not: ShopStaffStatus.REMOVED },
      ...(branchId ? { branchId } : {}),
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
        include: {
          user: { select: { name: true, email: true } },
          branch: { select: { name: true } },
        },
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
        branchId: row.branchId,
        branchName: row.branch?.name ?? null,
        permissions: effectivePermissions(row.role, row),
        defaultPermissions: [...(ROLE_PERMISSIONS[row.role] ?? [])],
        customised: row.extraPermissions.length + row.removedPermissions.length > 0,
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
    input: { shopId: string; userId: string; role: UserRole; branchId?: string | null },
  ): Promise<ShopStaffMemberResponse> {
    await this.assertMember(input.shopId, actorId);

    const targetUser = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!targetUser) {
      throw new NotFoundException("No such user.");
    }

    const membership = await this.prisma.$transaction((tx) =>
      this.addStaffWithin(tx, actorId, input),
    );

    // §45/16.6: shop-staff changes previously wrote no audit row at all.
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_ADDED,
      resourceType: "shop_staff",
      resourceId: membership.id,
      metadata: {
        shopId: input.shopId,
        userId: input.userId,
        role: input.role,
        branchId: membership.branchId,
        ...(membership.replacedAccess ? { replacedAccess: membership.replacedAccess } : {}),
      },
    });

    return this.toResponse(membership);
  }

  /** The locked authority decision + upsert of `addStaff`, inside the CALLER's transaction,
   * so another write (23.18: claiming an invitation) commits or rolls back with it. The caller
   * writes the audit row after commit; `replacedAccess` tells it what custom access the add
   * wiped (null when nothing was). */
  async addStaffWithin(
    tx: Prisma.TransactionClient,
    actorId: string,
    input: { shopId: string; userId: string; role: UserRole; branchId?: string | null },
  ): Promise<ShopStaff & { replacedAccess: AccessOverrides | null }> {
    // 23.12: the upsert can also demote/reactivate an EXISTING membership, so it is held
    // to the same rank rules as changeRole/removeStaff, decided under the same row locks.
    const { target, actor } = await this.authorizeMutationLocked(tx, {
      shopId: input.shopId,
      actorId,
      targetMembershipId: null,
      targetUserId: input.userId,
      newRole: input.role,
      removing: false,
    });
    // Re-adding a CURRENT member with the role they already have keeps their custom access.
    // A different role, or anyone who is not currently active (suspended or removed), starts
    // from the role's defaults: access nobody can see on a removed row must never come back
    // under an actor who does not hold it.
    const keepAccess =
      target.id !== "" && target.role === input.role && target.status === ShopStaffStatus.ACTIVE;
    const hadAccess = target.extraPermissions.length + target.removedPermissions.length > 0;
    const replacedAccess: AccessOverrides | null =
      !keepAccess && hadAccess
        ? {
            extraPermissions: target.extraPermissions,
            removedPermissions: target.removedPermissions,
          }
        : null;
    // Where they work: re-adding a current same-role member without naming a branch leaves their
    // branch alone; anything else is resolved (and checked) under the same locks.
    const branchId: string | null | undefined =
      keepAccess && input.branchId === undefined
        ? undefined
        : await this.resolveBranchForGrant(tx, {
            shopId: input.shopId,
            actor,
            role: input.role,
            requested: input.branchId,
          });
    const row = await tx.shopStaff.upsert({
      where: { shopId_userId: { shopId: input.shopId, userId: input.userId } },
      create: {
        shopId: input.shopId,
        userId: input.userId,
        role: input.role,
        status: ShopStaffStatus.ACTIVE,
        branchId: branchId ?? null,
      },
      update: keepAccess
        ? { status: ShopStaffStatus.ACTIVE, ...(branchId !== undefined ? { branchId } : {}) }
        : {
            role: input.role,
            status: ShopStaffStatus.ACTIVE,
            extraPermissions: [],
            removedPermissions: [],
            branchId: branchId ?? null,
          },
    });
    return { ...row, replacedAccess };
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
      const { target } = await this.authorizeMutationLocked(tx, {
        shopId: membership.shopId,
        actorId,
        targetMembershipId: membership.id,
        targetUserId: membership.userId,
        removing: true,
      });
      // A removed person keeps no custom access: nobody can see or clear it on a hidden row,
      // and re-adding them must start from their role's defaults. The audit row records it.
      await tx.shopStaff.update({
        where: { id: shopStaffId },
        data: { status: ShopStaffStatus.REMOVED, extraPermissions: [], removedPermissions: [] },
      });
      return target;
    });

    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_REMOVED,
      resourceType: "shop_staff",
      resourceId: shopStaffId,
      metadata: {
        shopId: membership.shopId,
        userId: membership.userId,
        role: before.role,
        ...(before.extraPermissions.length + before.removedPermissions.length > 0
          ? {
              clearedAccess: {
                extraPermissions: before.extraPermissions,
                removedPermissions: before.removedPermissions,
              },
            }
          : {}),
      },
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
      const { target } = await this.authorizeMutationLocked(tx, {
        shopId: membership.shopId,
        actorId,
        targetMembershipId: membership.id,
        targetUserId: membership.userId,
        newRole,
        removing: false,
      });
      // A new role starts from that role's own defaults: custom access never carries over.
      const row = await tx.shopStaff.update({
        where: { id: shopStaffId },
        data: {
          role: newRole,
          extraPermissions: [],
          removedPermissions: [],
          // An owner always works at all branches; an owner stepping down keeps that (only an
          // owner can do it), and anyone else keeps the branch they have.
          ...(newRole === UserRole.SHOP_OWNER ? { branchId: null } : {}),
        },
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
        accessReset: before.extraPermissions.length + before.removedPermissions.length > 0,
      },
    });
    // The reset IS an access change: keep what it replaced, the same way an edit does.
    if (before.extraPermissions.length + before.removedPermissions.length > 0) {
      await this.audit.record({
        actorId,
        action: AuditAction.SHOP_STAFF_ACCESS_CHANGED,
        resourceType: "shop_staff",
        resourceId: shopStaffId,
        metadata: {
          shopId: membership.shopId,
          userId: membership.userId,
          role: newRole,
          reason: "ROLE_CHANGED",
          before: {
            extraPermissions: before.extraPermissions,
            removedPermissions: before.removedPermissions,
          },
          after: { extraPermissions: [], removedPermissions: [] },
        },
      });
    }

    return this.toResponse(updated);
  }

  /** Per-person access: ticks individual permissions on or off on top of the role's defaults.
   * `desired` is the FULL list the person should hold afterwards; only the difference from the
   * role's defaults is stored. Decided under the same row locks as role changes, so the rank
   * rules are identical, plus:
   *   - nobody edits their own access, and an owner's access cannot be edited;
   *   - business settings (owner-only permissions) can never be held by a non-owner;
   *   - only NEWLY granted permissions are checked against the editor, so an editor can save
   *     changes to someone who already holds something the editor does not;
   *   - a manage permission brings the read permission it needs (`normalizePermissions`). */
  async updateAccess(
    shopStaffId: string,
    input: { permissions?: readonly Permission[]; branchId?: string | null },
    actorId: string,
  ): Promise<ShopStaffAccessResponse> {
    const membership = await this.prisma.shopStaff.findUnique({ where: { id: shopStaffId } });
    if (!membership) {
      throw new NotFoundException("No such shop staff membership.");
    }

    const { updated, before } = await this.prisma.$transaction(async (tx) => {
      const { target, actor, actorPermissions } = await this.authorizeMutationLocked(tx, {
        shopId: membership.shopId,
        actorId,
        targetMembershipId: membership.id,
        targetUserId: membership.userId,
        removing: false,
      });
      if (membership.userId === actorId) {
        throw new ForbiddenException("You cannot change your own access.");
      }
      if (target.role === UserRole.SHOP_OWNER) {
        throw new ForbiddenException("An owner's access cannot be edited.");
      }
      if (target.status === ShopStaffStatus.REMOVED) {
        throw new NotFoundException("No such shop staff membership.");
      }

      const data: Prisma.ShopStaffUncheckedUpdateInput = {};
      if (input.permissions !== undefined) {
        const wanted = normalizePermissions(input.permissions);
        if (wanted.some((p) => OWNER_ONLY_PERMISSIONS.includes(p))) {
          throw new ForbiddenException("Business settings can only be held by an owner.");
        }
        const current = effectivePermissions(target.role, target);
        const missing = wanted.filter((p) => !current.includes(p) && !actorPermissions.includes(p));
        if (missing.length > 0) {
          throw new ForbiddenException(
            `You cannot give access you do not have yourself (${missing.join(", ")}).`,
          );
        }
        const overrides = diffFromRole(target.role, wanted);
        data.extraPermissions = [...overrides.extraPermissions];
        data.removedPermissions = [...overrides.removedPermissions];
      }
      if (input.branchId !== undefined) {
        data.branchId = await this.resolveBranchForGrant(tx, {
          shopId: membership.shopId,
          actor,
          role: target.role,
          requested: input.branchId,
        });
      }
      const row = await tx.shopStaff.update({ where: { id: shopStaffId }, data });
      return { updated: row, before: target };
    });

    if (input.permissions !== undefined) {
      await this.audit.record({
        actorId,
        action: AuditAction.SHOP_STAFF_ACCESS_CHANGED,
        resourceType: "shop_staff",
        resourceId: shopStaffId,
        metadata: {
          shopId: membership.shopId,
          userId: membership.userId,
          role: updated.role,
          before: {
            extraPermissions: before.extraPermissions,
            removedPermissions: before.removedPermissions,
          },
          after: {
            extraPermissions: updated.extraPermissions,
            removedPermissions: updated.removedPermissions,
          },
        },
      });
    }
    if (input.branchId !== undefined && updated.branchId !== before.branchId) {
      await this.audit.record({
        actorId,
        action: AuditAction.SHOP_STAFF_BRANCH_CHANGED,
        resourceType: "shop_staff",
        resourceId: shopStaffId,
        metadata: {
          shopId: membership.shopId,
          userId: membership.userId,
          before: before.branchId,
          after: updated.branchId,
        },
      });
    }

    return {
      ...this.toResponse(updated),
      permissions: effectivePermissions(updated.role, updated),
    };
  }

  /** 23.15: the same authority decision an add would face, without adding anyone -- used
   * before sending an invitation, so nobody can invite above their own rank. */
  async assertMayGrant(
    actorId: string,
    shopId: string,
    role: UserRole,
    branchId?: string | null,
  ): Promise<string | null> {
    await this.assertMember(shopId, actorId);
    return this.prisma.$transaction(async (tx) => {
      const { actor } = await this.authorizeMutationLocked(tx, {
        shopId,
        actorId,
        targetMembershipId: null,
        targetUserId: "",
        newRole: role,
        removing: false,
      });
      // The branch the invited person will work at (all branches for an owner), decided by the
      // same rules as a direct add; the invitation records it.
      return this.resolveBranchForGrant(tx, { shopId, actor, role, requested: branchId });
    });
  }

  /** Where someone being granted `role` will work, decided under the caller's locks:
   *   - an owner always works at all branches (null);
   *   - `null` (all branches) can only be given by an owner;
   *   - a named branch must belong to this business and not be archived, and a branch-bound
   *     actor can only name their own;
   *   - nothing named: a branch-bound actor's own branch, else the business's only branch,
   *     else the request is refused (400 BRANCH_REQUIRED).
   * The branch row is share-locked, so it cannot be archived while an assignment to it commits. */
  private async resolveBranchForGrant(
    tx: Prisma.TransactionClient,
    params: {
      shopId: string;
      actor: { role: UserRole; branchId: string | null };
      role: UserRole;
      requested: string | null | undefined;
    },
  ): Promise<string | null> {
    const { shopId, actor, role } = params;
    if (role === UserRole.SHOP_OWNER) {
      return null;
    }
    let requested = params.requested;
    if (requested === null) {
      if (actor.role !== UserRole.SHOP_OWNER) {
        throw new ForbiddenException("Only an owner can give someone access to all branches.");
      }
      return null;
    }
    if (requested === undefined) {
      if (actor.branchId !== null) {
        requested = actor.branchId;
      } else {
        const open = await tx.branch.findMany({
          where: { shopId, archivedAt: null },
          select: { id: true },
          take: 2,
        });
        if (open.length !== 1) {
          throw new AppException(
            HttpStatus.BAD_REQUEST,
            "BRANCH_REQUIRED",
            "Choose which branch this person works at.",
            false,
          );
        }
        requested = open[0]!.id;
      }
    }
    const rows = await tx.$queryRaw<Array<{ archived_at: Date | null }>>`
      SELECT archived_at FROM branches WHERE id = ${requested} AND shop_id = ${shopId} FOR SHARE
    `;
    if (rows.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "BRANCH_NOT_FOUND",
        "No such branch in this business.",
        false,
      );
    }
    if (rows[0]!.archived_at) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "BRANCH_ARCHIVED",
        "That branch is archived.",
        false,
      );
    }
    if (actor.branchId !== null && requested !== actor.branchId) {
      throw new ForbiddenException("You can only assign people to your own branch.");
    }
    return requested;
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
  ): Promise<LockedAuthority> {
    const { shopId, actorId, targetMembershipId, targetUserId, newRole, removing } = params;
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        role: UserRole;
        status: ShopStaffStatus;
        extra_permissions: string[];
        removed_permissions: string[];
        branch_id: string | null;
      }>
    >`
      SELECT id, user_id, role::text AS role, status::text AS status,
             extra_permissions, removed_permissions, branch_id FROM shop_staff
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
    // What the actor holds RIGHT NOW, read under the lock. The route guard checked
    // MANAGE_USERS before the transaction, so it is re-checked here: someone whose "manage
    // staff" access was just taken away cannot finish what they started (a pending invitation
    // landing, or a request that raced the owner's edit).
    const actorPermissions = effectivePermissions(actor.role, {
      extraPermissions: actor.extra_permissions,
      removedPermissions: actor.removed_permissions,
    });
    if (!actorPermissions.includes(Permission.MANAGE_USERS)) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }

    const target = rows.find((row) => row.user_id === targetUserId) ?? null;
    if (targetMembershipId !== null && !target) {
      throw new NotFoundException("No such shop staff membership.");
    }
    // A branch-bound actor (their own branch is not null) only ever touches people of their own
    // branch: not another branch's, and not anyone who works at all branches.
    if (actor.branch_id !== null && target && target.branch_id !== actor.branch_id) {
      throw new ForbiddenException("That person belongs to another branch.");
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
    // No escalation by any route: a role (by Change role, invite or add) brings its defaults
    // with it, so the actor must hold every one of them. Otherwise a manager whose access was
    // trimmed could promote a colleague to a full manager, who could then hand it all back.
    if (newRole) {
      const missing = effectivePermissions(newRole).filter((p) => !actorPermissions.includes(p));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `You cannot grant this role: it includes access you do not have yourself (${missing.join(", ")}).`,
        );
      }
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

    return {
      target: target
        ? {
            id: target.id,
            role: target.role,
            status: target.status,
            extraPermissions: target.extra_permissions,
            removedPermissions: target.removed_permissions,
            branchId: target.branch_id,
          }
        : {
            id: "",
            role: UserRole.CUSTOMER,
            status: ShopStaffStatus.ACTIVE,
            extraPermissions: [],
            removedPermissions: [],
            branchId: null,
          },
      actor: { role: actor.role, branchId: actor.branch_id },
      actorPermissions,
    };
  }

  private toResponse(membership: ShopStaff): ShopStaffMemberResponse {
    return {
      id: membership.id,
      shopId: membership.shopId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      branchId: membership.branchId,
    };
  }
}
