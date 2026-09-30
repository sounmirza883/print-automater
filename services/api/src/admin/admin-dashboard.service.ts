import { Injectable } from "@nestjs/common";
import type { AdminDashboardResponse } from "@print-automated/types";
import { PrismaService } from "@print-automated/backend-shared";
import { HealthService } from "../health/health.service.js";
import { AuditAction } from "../audit/audit-action.js";
import { utcDayStart } from "../dashboard/dashboard.service.js";
import { RequestCounterService } from "../observability/request-counter.service.js";
import { REAL_USERS } from "./real-users.js";

const DAY_MS = 86_400_000;
const FIFTEEN_MIN_MS = 15 * 60_000;
const RECENT_ORDERS_LIMIT = 20;

/** 23.7: the only connected-device signal already in the schema
 * (`printers.agentsActive`, re-surfaced here). Deliberately not a Docker
 * container/replica count -- that would need Docker-socket access from the
 * API container, an unnecessary new security surface for a "nice to have"
 * figure. Surfaced verbatim in the UI as a hint on the tile. */
const INSTANCES_NOTE =
  "Printer agents connected (paired PrinterAgent rows reporting ACTIVE). " +
  "This is not a count of API/worker server instances or containers -- " +
  "that would require Docker-socket access from the API, which this platform " +
  "deliberately does not grant.";

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

interface ShopRevenueRow {
  shop_id: string;
  shop_name: string;
  currency: string;
  gross_today: bigint;
  refunded_today: bigint;
}

function toRecord<K extends string>(
  rows: Array<{ key: K; count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.key] = row.count;
  }
  return out;
}

/** 23.2 (PRD 42): platform-wide figures for the ADMIN dashboard. Like the rest of
 * the admin module it is deliberately NOT tenant-scoped (the controller's
 * `@Roles(ADMIN)` is the gate). Mostly COUNT/SUM aggregates, plus two small,
 * hard-capped row lists: `revenueByShop` (27.6, top 50 businesses by today's
 * gross) and `recentOrders` (23.7, the newest 20 orders platform-wide). Never
 * an unbounded list -- anything longer belongs on a paginated admin route. */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
    private readonly requestCounter: RequestCounterService,
  ) {}

  async get(): Promise<AdminDashboardResponse> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const since15m = new Date(now.getTime() - FIFTEEN_MIN_MS);
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
      revenueByShopRows,
      recentOrderRows,
      activeLogins,
    ] = await Promise.all([
      this.health.checkReadiness(),
      this.prisma.shop.groupBy({ by: ["status"], _count: { _all: true } }),
      // 24.1: people only -- a shop's synthetic QR-order account (role
      // SYSTEM) is neither a role bucket nor a status count here.
      this.prisma.user.groupBy({ by: ["role"], where: REAL_USERS, _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ["status"], where: REAL_USERS, _count: { _all: true } }),
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
      // 27.6: the SAME gross/refunded/net definitions as reports.service.ts's own
      // revenue() (gross = payments ever paid, dated by their stable paid_at; refunded =
      // COMPLETED refunds, dated by completion) but grouped by shop instead of by date --
      // reusing the definitions, not the shop-scoped method itself, since that method
      // takes one userId/shop, never every business at once. A correlated subquery for
      // refunds (rather than a second join) avoids a payments x refunds cross-product
      // inflating either sum. Capped at 50 rows, highest gross first: a platform-wide
      // dashboard panel, not a paginated report.
      this.prisma.$queryRaw<ShopRevenueRow[]>`
        SELECT
          s.id AS shop_id,
          s.name AS shop_name,
          ss.currency AS currency,
          COALESCE(SUM(p.amount_minor) FILTER (
            WHERE p.status IN ('PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED')
              AND p.paid_at >= ${utcDayStart(now)}
              AND p.currency = ss.currency
          ), 0)::bigint AS gross_today,
          COALESCE((
            SELECT SUM(r.amount_minor)
            FROM refunds r
            JOIN orders ro ON ro.id = r.order_id
            WHERE ro.shop_id = s.id
              AND r.status = 'REFUNDED'
              AND r.updated_at >= ${utcDayStart(now)}
              AND r.currency = ss.currency
          ), 0)::bigint AS refunded_today
        FROM shops s
        JOIN shop_settings ss ON ss.shop_id = s.id
        LEFT JOIN orders o ON o.shop_id = s.id
        LEFT JOIN payments p ON p.order_id = o.id
        GROUP BY s.id, s.name, ss.currency
        ORDER BY gross_today DESC
        LIMIT 50
      `,
      // 23.7: last ~20 orders, newest first, platform-wide -- a plain
      // findMany (this is a bounded row list, not an aggregate, but the
      // dashboard's own "recent orders" panel is exactly that).
      this.prisma.order.findMany({
        take: RECENT_ORDERS_LIMIT,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          publicOrderNumber: true,
          orderStatus: true,
          createdAt: true,
          shop: { select: { name: true } },
        },
      }),
      // 23.7: "active users now" = distinct actorId with a LOGIN audit row
      // in the last 15 minutes. Reuses the existing audit log; no new
      // Redis-backed session tracking.
      this.prisma.auditLog.findMany({
        where: {
          action: AuditAction.LOGIN,
          createdAt: { gte: since15m },
          actorId: { not: null },
        },
        distinct: ["actorId"],
        select: { actorId: true },
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
    const revenueByShop = revenueByShopRows.map((row) => ({
      shopId: row.shop_id,
      shopName: row.shop_name,
      currency: row.currency,
      grossTodayMinor: Number(row.gross_today),
      netTodayMinor: Number(row.gross_today) - Number(row.refunded_today),
    }));

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
      revenueByShop,
      recentOrders: recentOrderRows.map((o) => ({
        id: o.id,
        publicOrderNumber: o.publicOrderNumber,
        shopName: o.shop.name,
        status: o.orderStatus,
        createdAt: o.createdAt.toISOString(),
      })),
      activeUsersNow: activeLogins.length,
      traffic: this.requestCounter.getStats(),
      instances: { printerAgentsConnected: agentsActive, note: INSTANCES_NOTE },
    };
  }
}
