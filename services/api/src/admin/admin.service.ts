import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  type AuditLog,
  type Prisma,
  type Shop,
  type User,
  type UserRole,
  type UserStatus,
} from "@prisma/client";
import { AuditService, PrismaService } from "@print-automated/backend-shared";
import type {
  AdminListQueryInput,
  AdminAuditQueryInput,
  CreateBusinessInput,
} from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { HealthService, type ReadinessResult } from "../health/health.service.js";
import { TokenService } from "../auth/token.service.js";
import { REAL_USERS } from "./real-users.js";

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

  /** 23.7/Workstream A: an admin creating a business outright (PRD §106's
   * fallback: "MVP can use administrator-assisted shop onboarding").
   * `status` is never accepted from the client -- every new business is
   * born `CLOSED` (the schema's own default) until its own staff open it,
   * and `id` is always server-generated. No `qrSystemUserId` is touched
   * here: that field doesn't exist until a later task, whose lazy-
   * creation design has no dependency on business creation at all. */
  async createBusiness(
    actorId: string,
    input: CreateBusinessInput,
  ): Promise<AdminBusinessResponse> {
    const shop = await this.prisma.shop.create({
      data: {
        name: input.name,
        address: input.address,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        phone: input.phone ?? null,
        capabilities: input.capabilities ?? undefined,
      },
    });
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_CREATED,
      resourceType: "shop",
      resourceId: shop.id,
      metadata: { name: shop.name },
    });
    return {
      id: shop.id,
      name: shop.name,
      address: shop.address,
      status: shop.status,
      createdAt: shop.createdAt,
    };
  }

  /** 23.7/Workstream A: one business's detail -- the shop row plus how
   * much is actually happening there (active staff, orders, printers) --
   * so an admin can tell a real, working business from an empty shell. */
  async getBusiness(id: string): Promise<AdminBusinessDetailResponse> {
    const shop = await this.prisma.shop.findUnique({ where: { id } });
    if (!shop) {
      throw new NotFoundException("Business not found.");
    }
    const [staff, orders, printers] = await Promise.all([
      this.prisma.shopStaff.count({ where: { shopId: id, status: "ACTIVE" } }),
      this.prisma.order.count({ where: { shopId: id } }),
      this.prisma.printer.count({ where: { shopId: id } }),
    ]);
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
