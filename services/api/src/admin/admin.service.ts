import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  ShopStaffStatus,
  UserRole,
  type AuditLog,
  type Shop,
  type User,
  type UserStatus,
} from "@prisma/client";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import type {
  AdminListQueryInput,
  AdminAuditQueryInput,
  CreateBusinessInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { HealthService, type ReadinessResult } from "../health/health.service.js";
import { PASSWORD_NOT_SET, PasswordService } from "../auth/password.service.js";
import { TokenService } from "../auth/token.service.js";
import { ShopStaffInvitesService } from "../shop-staff/shop-staff-invites.service.js";
import { REAL_USERS } from "./real-users.js";

const OWNER_EMAIL_IN_USE = () =>
  new AppException(
    HttpStatus.CONFLICT,
    "OWNER_EMAIL_IN_USE",
    "An account with this email already exists. Use a different email for the new business's owner.",
    false,
  );

/** 24.1: a SYSTEM account's role and status belong to the QR-ordering
 * machinery that created it, not to an admin -- refused, not silently kept. */
function assertNotSystemAccount(role: UserRole): void {
  if (role === "SYSTEM") {
    throw new ForbiddenException("A system account's role and status cannot be changed.");
  }
}

export interface AdminBusinessResponse {
  id: string;
  name: string;
  address: string;
  status: Shop["status"];
  createdAt: Date;
}

/** Fix wave 1: the person an admin named as a new business's owner. */
export interface AdminBusinessOwner {
  id: string;
  name: string;
  email: string;
}

/** `POST /admin/businesses`: the new business plus its owner's account. */
export interface AdminBusinessCreatedResponse extends AdminBusinessResponse {
  owner: AdminBusinessOwner;
}

export interface AdminBusinessDetailResponse extends AdminBusinessResponse {
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  capabilities: Shop["capabilities"];
  counts: {
    staff: number;
    orders: number;
    printers: number;
  };
  /** Fix wave 1: false until the business has saved at least one price list. Until then
   * every order to it -- QR, counter or web -- is refused with 409
   * SHOP_PRICING_NOT_CONFIGURED, so a QR code for it would only lead guests to an error. */
  hasPricingRule: boolean;
  /** Fix wave 1: the business's first active owner, or null if it has none (only possible
   * for a business created before admin onboarding named one). `activationPending` is true
   * while they have not yet set their password with the emailed code -- the admin can
   * re-issue that code (`POST /admin/businesses/:id/owner-invite`). */
  owner: (AdminBusinessOwner & { activationPending: boolean }) | null;
}

export interface AdminUserResponse {
  id: string;
  name: string;
  email: string;
  role: User["role"];
  status: User["status"];
  createdAt: Date;
}

export interface AdminAuditEntryResponse {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AdminListResult<T> {
  items: T[];
  total: number;
  /** 23.6: the page bounds actually applied (same numbers as the request's take/skip). */
  limit: number;
  offset: number;
}

export interface AdminSystemStatus {
  readiness: ReadinessResult;
  counts: {
    shops: number;
    users: number;
    activeStaff: number;
    printers: number;
  };
}

/** §4.7/§42/16.5: platform-wide reads with no shop boundary at all --
 * deliberately NEVER routed through ShopScopeGuard or ShopMembershipService,
 * unlike everything else in this codebase. Gated purely by `@Roles(ADMIN)`
 * on the controller. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthService: HealthService,
    private readonly audit: AuditService,
    private readonly tokenService: TokenService,
    private readonly passwords: PasswordService,
    private readonly invites: ShopStaffInvitesService,
  ) {}

  async listBusinesses(
    query: AdminListQueryInput,
  ): Promise<AdminListResult<AdminBusinessResponse>> {
    const [items, total] = await Promise.all([
      this.prisma.shop.findMany({
        take: query.take,
        skip: query.skip,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.shop.count(),
    ]);
    return {
      items: items.map((shop) => ({
        id: shop.id,
        name: shop.name,
        address: shop.address,
        status: shop.status,
        createdAt: shop.createdAt,
      })),
      total,
      limit: query.take,
      offset: query.skip,
    };
  }

  /** 23.7/Workstream A + fix wave 1: an admin creating a business (PRD §106's
   * "administrator-assisted shop onboarding" -- since fix wave 1 the ONLY way a business
   * is created; public self-service signup was removed). In ONE transaction:
   *   - the Shop -- `status` never from the client: born `CLOSED` (the schema's default)
   *     until its owner opens it; `id` always server-generated;
   *   - the named owner's User, role SHOP_OWNER (never client-supplied), with NO password
   *     (PASSWORD_NOT_SET -- the admin never knows it, and it cannot sign in yet);
   *   - their ACTIVE SHOP_OWNER membership, so the business has a real owner from the
   *     first moment (nothing else could ever attach one: every other path that grants
   *     access needs an existing member to grant it);
   *   - a pending SHOP_OWNER invitation carrying a single-use code
   *     (ShopStaffInvitesService's narrow admin-onboarding exception).
   * After commit, the owner is emailed that code; with it they choose their own password
   * (`POST /shop/staff-invites/activate`) and are signed in. `capabilities` is required
   * (every order is checked against it, and no route lets a business set it later -- an
   * undeclared shop could never take an order). No PricingRule is invented:
   * the owner sets real prices, and until then orders are refused with 409
   * SHOP_PRICING_NOT_CONFIGURED (`hasPricingRule` on the detail tells the admin).
   * An owner email that already has an account is refused (409 OWNER_EMAIL_IN_USE):
   * attaching an existing account to a new business is not something this does. The
   * shop's `qrSystemUserId` is untouched -- it is created lazily by the first QR request. */
  async createBusiness(
    actorId: string,
    input: CreateBusinessInput,
  ): Promise<AdminBusinessCreatedResponse> {
    const ownerEmail = input.owner.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } })) {
      throw OWNER_EMAIL_IN_USE();
    }

    let created: {
      shop: Shop;
      owner: AdminBusinessOwner;
      issued: Awaited<ReturnType<ShopStaffInvitesService["issuePendingOwnerInviteWithin"]>>;
    };
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const shop = await tx.shop.create({
            data: {
              name: input.name,
              address: input.address,
              latitude: input.latitude ?? null,
              longitude: input.longitude ?? null,
              phone: input.phone ?? null,
              // Required (see createBusinessSchema): every order is checked against it.
              capabilities: input.capabilities,
            },
          });
          const owner = await tx.user.create({
            data: {
              role: UserRole.SHOP_OWNER,
              name: input.owner.name,
              email: ownerEmail,
              phone: input.owner.phone ?? null,
              passwordHash: PASSWORD_NOT_SET,
            },
            select: { id: true, name: true, email: true },
          });
          await tx.shopStaff.create({
            data: {
              shopId: shop.id,
              userId: owner.id,
              role: UserRole.SHOP_OWNER,
              status: ShopStaffStatus.ACTIVE,
            },
          });
          const issued = await this.invites.issuePendingOwnerInviteWithin(tx, actorId, {
            shopId: shop.id,
            ownerUserId: owner.id,
          });
          return { shop, owner, issued };
        },
        { maxWait: 10_000, timeout: 10_000 },
      );
    } catch (error) {
      // The pre-check above does not close the race under READ COMMITTED: two concurrent
      // creations naming the same email can both pass it. users.email @unique still
      // prevents a duplicate, and the loser's raw P2002 becomes the same 409.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw OWNER_EMAIL_IN_USE();
      }
      throw error;
    }

    const { shop, owner, issued } = created;
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_CREATED,
      resourceType: "shop",
      resourceId: shop.id,
      metadata: { name: shop.name, ownerUserId: owner.id },
    });
    await this.invites.deliverPendingOwnerInvite(actorId, shop.id, issued);
    return {
      id: shop.id,
      name: shop.name,
      address: shop.address,
      status: shop.status,
      createdAt: shop.createdAt,
      owner,
    };
  }

  /** Fix wave 1: re-issue the owner's code (a fresh one; the previous code stops working)
   * while they still have not activated -- e.g. the 7-day code expired or the email was
   * lost. Refused once they have a password (409 OWNER_ALREADY_ACTIVE: they sign in
   * normally, and a forgotten password is not this route's business). Audited like every
   * invitation (SHOP_STAFF_INVITED). */
  async reissueOwnerInvite(actorId: string, shopId: string): Promise<{ result: "PROCESSED" }> {
    const ownerMembership = await this.prisma.shopStaff.findFirst({
      where: { shopId, role: UserRole.SHOP_OWNER, status: ShopStaffStatus.ACTIVE },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (!ownerMembership) {
      if (!(await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } }))) {
        throw new NotFoundException("Business not found.");
      }
      throw new NotFoundException("This business has no owner waiting to activate.");
    }
    const issued = await this.prisma.$transaction((tx) =>
      this.invites.issuePendingOwnerInviteWithin(tx, actorId, {
        shopId,
        ownerUserId: ownerMembership.userId,
      }),
    );
    await this.invites.deliverPendingOwnerInvite(actorId, shopId, issued);
    return { result: "PROCESSED" };
  }

  /** 23.7/Workstream A: one business's detail -- the shop row plus how
   * much is actually happening there (active staff, orders, printers) --
   * so an admin can tell a real, working business from an empty shell.
   * Fix wave 1: plus whether it has any pricing yet, and who its owner is
   * and whether they have activated their account. */
  async getBusiness(id: string): Promise<AdminBusinessDetailResponse> {
    const shop = await this.prisma.shop.findUnique({ where: { id } });
    if (!shop) {
      throw new NotFoundException("Business not found.");
    }
    const [staff, orders, printers, pricingRules, ownerMembership] = await Promise.all([
      this.prisma.shopStaff.count({ where: { shopId: id, status: "ACTIVE" } }),
      this.prisma.order.count({ where: { shopId: id } }),
      this.prisma.printer.count({ where: { shopId: id } }),
      this.prisma.pricingRule.count({ where: { shopId: id } }),
      this.prisma.shopStaff.findFirst({
        where: { shopId: id, role: UserRole.SHOP_OWNER, status: ShopStaffStatus.ACTIVE },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { id: true, name: true, email: true, passwordHash: true } } },
      }),
    ]);
    const ownerUser = ownerMembership?.user;
    return {
      id: shop.id,
      name: shop.name,
      address: shop.address,
      status: shop.status,
      createdAt: shop.createdAt,
      phone: shop.phone,
      latitude: shop.latitude,
      longitude: shop.longitude,
      capabilities: shop.capabilities,
      counts: { staff, orders, printers },
      hasPricingRule: pricingRules > 0,
      owner: ownerUser
        ? {
            id: ownerUser.id,
            name: ownerUser.name,
            email: ownerUser.email,
            // Never the hash itself -- only whether one has been chosen yet.
            activationPending: !this.passwords.isPasswordSet(ownerUser.passwordHash),
          }
        : null,
    };
  }

  /** 23.7/Workstream A: an admin forcing a business's status (e.g.
   * suspending one for abuse) -- distinct from a shop owner's own
   * settings-driven open/close toggle, and audited so it's traceable
   * as a platform action rather than the business's own choice. */
  async updateBusinessStatus(
    actorId: string,
    shopId: string,
    status: Shop["status"],
  ): Promise<AdminBusinessResponse> {
    const existing = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException("Business not found.");
    }
    const shop = await this.prisma.shop.update({ where: { id: shopId }, data: { status } });
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STATUS_CHANGED,
      resourceType: "shop",
      resourceId: shop.id,
      metadata: { from: existing.status, to: status },
    });
    return {
      id: shop.id,
      name: shop.name,
      address: shop.address,
      status: shop.status,
      createdAt: shop.createdAt,
    };
  }

  /** passwordHash is never selected -- an admin listing needs no more
   * than every other authenticated read in this codebase already
   * exposes about a user (id/name/email/role/status). */
  async listUsers(query: AdminListQueryInput): Promise<AdminListResult<AdminUserResponse>> {
    const select = {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    } satisfies Prisma.UserSelect;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: REAL_USERS,
        take: query.take,
        skip: query.skip,
        orderBy: { createdAt: "desc" },
        select,
      }),
      this.prisma.user.count({ where: REAL_USERS }),
    ]);
    return { items, total, limit: query.take, offset: query.skip };
  }

  /** Workstream B: one user's detail -- the same shape `listUsers` already
   * returns per row (no password hash), just addressable by id. */
  async getUser(id: string): Promise<AdminUserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });
    if (!user) {
      throw new NotFoundException("User not found.");
    }
    return user;
  }

  /** Workstream B: an admin changing a user's platform-wide role.
   * Self-lockout guard: an admin may not demote themselves out of ADMIN --
   * doing so through this very route would leave them unable to undo it,
   * since every route here is gated `@Roles(ADMIN)`. Changing someone
   * else's role, in either direction (including granting ADMIN), is
   * always allowed -- every caller is already ADMIN, the platform's top
   * role, so there is no cross-role "may I grant this" check to make
   * (unlike ShopStaffService.assertMayGrant, which exists because a
   * shop's own roles are ranked against each other). */
  async updateUserRole(
    actorId: string,
    targetUserId: string,
    role: UserRole,
  ): Promise<AdminUserResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true },
    });
    if (!existing) {
      throw new NotFoundException("User not found.");
    }
    assertNotSystemAccount(existing.role);
    if (targetUserId === actorId && role !== existing.role && existing.role === "ADMIN") {
      throw new ForbiddenException("You cannot change your own role away from admin.");
    }
    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });
    await this.audit.record({
      actorId,
      action: AuditAction.USER_ROLE_CHANGED,
      resourceType: "user",
      resourceId: user.id,
      metadata: { from: existing.role, to: role },
    });
    return user;
  }

  /** Workstream B: an admin forcing a user's account status (suspend/
   * delete/reactivate). Self-lockout guard mirrors `updateUserRole`: an
   * admin may not deactivate their own account. Suspending or deleting
   * also revokes every currently-unrevoked refresh token the user holds
   * (TokenService.revokeAllForUser), so an already-issued token can't
   * keep working after the account is meant to be locked out. */
  async updateUserStatus(
    actorId: string,
    targetUserId: string,
    status: UserStatus,
  ): Promise<AdminUserResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, status: true, role: true },
    });
    if (!existing) {
      throw new NotFoundException("User not found.");
    }
    assertNotSystemAccount(existing.role);
    const deactivating = status === "SUSPENDED" || status === "DELETED";
    if (targetUserId === actorId && deactivating) {
      throw new ForbiddenException("You cannot suspend or delete your own account.");
    }
    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { status },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    });
    if (deactivating) {
      await this.tokenService.revokeAllForUser(targetUserId);
    }
    await this.audit.record({
      actorId,
      action: AuditAction.USER_STATUS_CHANGED,
      resourceType: "user",
      resourceId: user.id,
      metadata: { from: existing.status, to: status },
    });
    return user;
  }

  /** §45/16.6: the first read access this codebase has ever had onto
   * `audit_logs` -- append-only writes existed since Phase 1, nothing
   * before this could ever list them back out. */
  async listAudit(query: AdminAuditQueryInput): Promise<AdminListResult<AdminAuditEntryResponse>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        take: query.take,
        skip: query.skip,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((entry) => this.toAuditResponse(entry)),
      total,
      limit: query.take,
      offset: query.skip,
    };
  }

  async getSystemStatus(): Promise<AdminSystemStatus> {
    const [readiness, shops, users, activeStaff, printers] = await Promise.all([
      this.healthService.checkReadiness(),
      this.prisma.shop.count(),
      this.prisma.user.count({ where: REAL_USERS }),
      this.prisma.shopStaff.count({ where: { status: "ACTIVE" } }),
      this.prisma.printer.count(),
    ]);
    return { readiness, counts: { shops, users, activeStaff, printers } };
  }

  private toAuditResponse(entry: AuditLog): AdminAuditEntryResponse {
    return {
      id: entry.id,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    };
  }
}
