import { Injectable } from "@nestjs/common";
import type { AdminDashboardResponse } from "@print-automated/types";
import { PrismaService } from "@print-automated/backend-shared";
import { HealthService } from "../health/health.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { utcDayStart } from "../dashboard/dashboard.service.js";

const DAY_MS = 86_400_000;

/** Audit actions an administrator watches for: who can act on the business changed,
 * a device was paired, or configuration changed. */
const SECURITY_ACTIONS: string[] = [
  AuditAction.SHOP_STAFF_ADDED,
  AuditAction.SHOP_STAFF_ROLE_CHANGED,
  AuditAction.SHOP_STAFF_REMOVED,
  AuditAction.PAIRING_CODE_ISSUED,
  AuditAction.PAIRING_CODE_REDEEMED,
  AuditAction.SHOP_SETTINGS_CHANGED,
  // Workstream B: an admin changing a user's platform-wide role/status is
  // exactly the kind of event this panel watches for.
  AuditAction.USER_ROLE_CHANGED,
  AuditAction.USER_STATUS_CHANGED,
];

function toRecord<K extends string>(
  rows: Array<{ key: K; count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.key] = row.count;
  }
  return out;
}

/** 23.2 (PRD 42): platform-wide aggregates for the ADMIN dashboard. Like the rest of
 * the admin module it is deliberately NOT tenant-scoped (the controller's
 * `@Roles(ADMIN)` is the gate); every figure is a COUNT/SUM, never a row list. */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  async get(): Promise<AdminDashboardResponse> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const [
      readiness,
      shops,
      userRoles,
      userStatuses,
      orders,
      ordersToday,
      printers,
      agentsActive,
      storage,
      failedJobs,
      failedPayments,
      security,
    ] = await Promise.all([
      this.health.checkReadiness(),
      this.prisma.shop.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.order.groupBy({ by: ["orderStatus"], _count: { _all: true } }),
      this.prisma.order.count({ where: { createdAt: { gte: utcDayStart(now) } } }),
      this.prisma.printer.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.printerAgent.count({ where: { status: "ACTIVE" } }),
      this.prisma.document.aggregate({
        where: { status: "READY" },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.printJob.count({
        where: { status: { in: ["FAILED", "TIMEOUT"] }, updatedAt: { gte: since24h } },
      }),
      this.prisma.payment.count({ where: { status: "FAILED", updatedAt: { gte: since24h } } }),
      this.prisma.auditLog.groupBy({
        by: ["action"],
        where: { action: { in: SECURITY_ACTIONS }, createdAt: { gte: since24h } },
        _count: { _all: true },
      }),
    ]);

    const businessesByStatus = toRecord(
      shops.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const byRole = toRecord(userRoles.map((r) => ({ key: r.role, count: r._count._all })));
    const byUserStatus = toRecord(
      userStatuses.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const byOrderStatus = toRecord(
      orders.map((r) => ({ key: r.orderStatus, count: r._count._all })),
    );
    const byPrinterStatus = toRecord(
      printers.map((r) => ({ key: r.status, count: r._count._all })),
    );
    const byAction = toRecord(security.map((r) => ({ key: r.action, count: r._count._all })));
    const sum = (record: Record<string, number>): number =>
      Object.values(record).reduce((a, b) => a + b, 0);

    return {
      generatedAt: now.toISOString(),
      businesses: { total: sum(businessesByStatus), byStatus: businessesByStatus },
      users: { total: sum(byRole), byRole, byStatus: byUserStatus },
      orders: { total: sum(byOrderStatus), today: ordersToday, byStatus: byOrderStatus },
      printers: { total: sum(byPrinterStatus), byStatus: byPrinterStatus, agentsActive },
      storage: { documents: storage._count._all, readyBytes: storage._sum.sizeBytes ?? 0 },
      system: { ready: readiness.ready, checks: readiness.checks },
      errors: { failedJobs24h: failedJobs, failedPayments24h: failedPayments },
      securityEvents24h: { total: sum(byAction), byAction },
      subscriptions: null,
    };
  }
}
