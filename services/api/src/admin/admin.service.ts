import { Injectable } from "@nestjs/common";
import { type AuditLog, type Prisma, type Shop, type User } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import type { AdminListQueryInput, AdminAuditQueryInput } from "@print-automated/validation";
import { HealthService, type ReadinessResult } from "../health/health.service.js";

export interface AdminBusinessResponse {
  id: string;
  name: string;
  address: string;
  status: Shop["status"];
  createdAt: Date;
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
        take: query.take,
        skip: query.skip,
        orderBy: { createdAt: "desc" },
        select,
      }),
      this.prisma.user.count(),
    ]);
    return { items, total };
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
    return { items: items.map((entry) => this.toAuditResponse(entry)), total };
  }

  async getSystemStatus(): Promise<AdminSystemStatus> {
    const [readiness, shops, users, activeStaff, printers] = await Promise.all([
      this.healthService.checkReadiness(),
      this.prisma.shop.count(),
      this.prisma.user.count(),
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
