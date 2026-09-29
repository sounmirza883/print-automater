import { ForbiddenException, Injectable, type MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { OrderCreationSource, OrderStatus, Prisma, PrintJobStatus } from "@prisma/client";
import type {
  DashboardJob,
  DashboardOrderGroups,
  DashboardPrinter,
  OperatorDashboardResponse,
  OwnerDashboardResponse,
  PrinterDashboardResponse,
} from "@print-automated/types";
import {
  DashboardEventsService,
  jobPages,
  periodStart,
  PrismaService,
} from "@print-automated/backend-shared";
import type {
  OperatorDashboardQueryInput,
  OwnerDashboardQueryInput,
  ShopDashboardQueryInput,
} from "@print-automated/validation";
import { JOB_PAGES_JOINS, JOB_TOTAL_PAGES } from "../analytics/job-pages-sql.js";
import { pickCurrency } from "../common/money.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import {
  GROUP_BY_STATUS,
  SHOP_VISIBLE_STATUSES,
  groupForOrder,
  shopVisibleWhere,
} from "../shop-orders/shop-orders.service.js";

const DAY_MS = 86_400_000;
/** The offline sweep's own threshold (services/worker printer-offline-sweep). */
const MISSED_HEARTBEAT_MS = 90_000;
/** Orders in these statuses can no longer be acted on, so their jobs never need attention. */
const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.SHOP_REJECTED,
  OrderStatus.EXPIRED,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.DRAFT,
];
const QUEUE_STATUSES: PrintJobStatus[] = [
  PrintJobStatus.CREATED,
  PrintJobStatus.WAITING,
  PrintJobStatus.QUEUED,
];
const PRINTING_GROUP_STATUSES = SHOP_VISIBLE_STATUSES.filter(
  (status) => GROUP_BY_STATUS[status] === "printing",
);

const JOB_SELECT = {
  id: true,
  orderId: true,
  status: true,
  priority: true,
  printerId: true,
  operatorId: true,
  blockedReason: true,
  pausedAt: true,
  createdAt: true,
  updatedAt: true,
  printer: { select: { name: true } },
  orderItem: {
    select: {
      quantity: true,
      printConfiguration: true,
      document: { select: { filename: true, pageCount: true } },
    },
  },
  order: {
    select: {
      publicOrderNumber: true,
      printConfiguration: true,
      document: { select: { filename: true, pageCount: true } },
    },
  },
} satisfies Prisma.PrintJobSelect;
type JobRow = Prisma.PrintJobGetPayload<{ select: typeof JOB_SELECT }>;

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const n = (value: unknown): number => Number(value ?? 0);

function emptyGroups(): DashboardOrderGroups {
  return { needsAttention: 0, printing: 0, ready: 0, completed: 0, failed: 0 };
}

/** 23.2 (PRD 39-41): tenant-scoped dashboard aggregates. Every method starts by
 * proving the caller is ACTIVE staff of the requested shop (403 otherwise, the
 * same convention as the rest of the shop API), and every query filters by that
 * `shopId`. Aggregates are SQL `count`/`sum`/`GROUP BY`; the only row loads are
 * the operator/printer lists, which are capped. Nothing here writes. */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly dashboardEvents: DashboardEventsService,
  ) {}

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's dashboard.");
    }
  }

  /** 27.2: a ping-only SSE stream -- `{ kind }`, never a payload, so no aggregation logic is
   * duplicated over the wire. The browser's own EventSource calls this once and keeps the
   * connection open; on each event the frontend re-fetches whichever REST aggregate endpoint
   * it would have polled anyway (owner/printers/operator), via useResource's reload(). Real
   * membership check here (not just `@ShopScopedField`'s effective-role fallback) since nothing
   * downstream re-checks shopId the way a REST handler's own service call does. */
  async live(userId: string, shopId: string): Promise<Observable<MessageEvent>> {
    await this.assertMember(shopId, userId);
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.dashboardEvents.subscribe((event) => {
        if (event.shopId === shopId) {
          subscriber.next({ data: { kind: event.kind } });
        }
      });
      return unsubscribe;
    });
  }

  /** Orders by raw status, restricted to the orders a shop can see -- which (24.1)
   * includes QR orders awaiting payment, so an UPLOADED count here is QR orders only. */
  private async statusCounts(
    shopId: string,
    range?: { from: Date; to: Date },
  ): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ["orderStatus"],
      where: {
        shopId,
        ...shopVisibleWhere(),
        ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
      },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.orderStatus] = row._count._all;
    }
    return out;
  }

  /** "In production" orders that have a live job parked WAITING with a reason are
   * STRANDED (shop-orders `groupForOrder`): a human has to act, so they move from
   * `printing` to `needsAttention`. */
  private async strandedCount(shopId: string, range?: { from: Date; to: Date }): Promise<number> {
    const createdFilter = range
      ? Prisma.sql`AND o.created_at >= ${range.from} AND o.created_at <= ${range.to}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(DISTINCT o.id)::int AS count
      FROM orders o
      JOIN print_jobs j ON j.order_id = o.id
      WHERE o.shop_id = ${shopId}
        AND o.order_status::text = ANY(${PRINTING_GROUP_STATUSES as string[]})
        AND j.superseded_at IS NULL
        AND j.status = 'WAITING'
        AND j.blocked_reason IS NOT NULL
        ${createdFilter}`;
    return n(rows[0]?.count);
  }

  private toGroups(byStatus: Record<string, number>, stranded: number): DashboardOrderGroups {
    const groups = emptyGroups();
    for (const [status, count] of Object.entries(byStatus)) {
      // statusCounts admits UPLOADED only for QR orders awaiting payment, which the
      // orders list shows in needsAttention (shop-orders groupForOrder, 24.1).
      const group = groupForOrder(
        status as OrderStatus,
        [],
        status === OrderStatus.UPLOADED ? OrderCreationSource.QR : OrderCreationSource.CUSTOMER_WEB,
      );
      if (group && group !== "hidden") {
        groups[group] += count;
      }
    }
    groups.printing -= stranded;
    groups.needsAttention += stranded;
    return groups;
  }

  async owner(userId: string, query: OwnerDashboardQueryInput): Promise<OwnerDashboardResponse> {
    const { shopId } = query;
    await this.assertMember(shopId, userId);
    const now = new Date();
    const to = query.to ?? now;
    const from = query.from ?? new Date(to.getTime() - 7 * DAY_MS);
    const range = { from, to };
    const todayStart = utcDayStart(now);

    const [
      settings,
      periodByStatus,
      allByStatus,
      periodStranded,
      allStranded,
      todayCount,
      completedInPeriod,
      revenue,
      liveJobs,
      periodJobs,
      printerRows,
      inventory,
      openAlerts,
      trackingFlag,
      attention,
    ] = await Promise.all([
      this.prisma.shopSettings.findUnique({ where: { shopId }, select: { currency: true } }),
      this.statusCounts(shopId, range),
      this.statusCounts(shopId),
      this.strandedCount(shopId, range),
      this.strandedCount(shopId),
      this.prisma.order.count({
        where: {
          shopId,
          ...shopVisibleWhere(),
          createdAt: { gte: todayStart },
        },
      }),
      this.prisma.order.count({
        where: { shopId, orderStatus: OrderStatus.COMPLETED, completedAt: { gte: from, lte: to } },
      }),
      // 23.10: revenue, per currency (money is never summed across currencies). Gross =
      // payments ever paid, dated by their STABLE paid_at; refunded = COMPLETED refunds
      // (refunds.amount_minor) dated by completion. REFUND_PENDING/REFUND_FAILED stay in.
      this.prisma.$queryRaw<
        Array<{
          currency: string;
          g_today: bigint;
          g_period: bigint;
          paid_orders: number;
          r_today: bigint;
          r_period: bigint;
        }>
      >`
        WITH g AS (
          SELECT p.currency,
            COALESCE(SUM(p.amount_minor) FILTER (WHERE p.paid_at >= ${todayStart}), 0)::bigint AS g_today,
            COALESCE(SUM(p.amount_minor) FILTER (WHERE p.paid_at >= ${from} AND p.paid_at <= ${to}), 0)::bigint AS g_period,
            (COUNT(DISTINCT p.order_id) FILTER (WHERE p.paid_at >= ${from} AND p.paid_at <= ${to}))::int AS paid_orders
          FROM payments p
          JOIN orders o ON o.id = p.order_id
          WHERE o.shop_id = ${shopId}
            AND p.status IN ('PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED')
            AND p.paid_at >= ${todayStart < from ? todayStart : from}
          GROUP BY p.currency
        ), r AS (
          SELECT rf.currency,
            COALESCE(SUM(rf.amount_minor) FILTER (WHERE rf.updated_at >= ${todayStart}), 0)::bigint AS r_today,
            COALESCE(SUM(rf.amount_minor) FILTER (WHERE rf.updated_at >= ${from} AND rf.updated_at <= ${to}), 0)::bigint AS r_period
          FROM refunds rf
          JOIN orders o ON o.id = rf.order_id
          WHERE o.shop_id = ${shopId}
            AND rf.status = 'REFUNDED'
            AND rf.updated_at >= ${todayStart < from ? todayStart : from}
          GROUP BY rf.currency
        )
        SELECT COALESCE(g.currency, r.currency) AS currency,
          COALESCE(g.g_today, 0)::bigint AS g_today, COALESCE(g.g_period, 0)::bigint AS g_period,
          COALESCE(g.paid_orders, 0)::int AS paid_orders,
          COALESCE(r.r_today, 0)::bigint AS r_today, COALESCE(r.r_period, 0)::bigint AS r_period
        FROM g FULL OUTER JOIN r ON r.currency = g.currency`,
      this.prisma.printJob.groupBy({
        by: ["status"],
        where: { shopId, supersededAt: null, status: { in: [...QUEUE_STATUSES, "PRINTING"] } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ printed: number; pages: bigint; failed: number }>>`
        SELECT
          (COUNT(*) FILTER (WHERE j.status = 'PRINTED'))::int AS printed,
          COALESCE(SUM(${JOB_TOTAL_PAGES}) FILTER (WHERE j.status = 'PRINTED'), 0)::bigint AS pages,
          (COUNT(*) FILTER (WHERE j.status IN ('FAILED', 'TIMEOUT')))::int AS failed
        FROM print_jobs j
        ${JOB_PAGES_JOINS}
        WHERE j.shop_id = ${shopId}
          AND j.status IN ('PRINTED', 'FAILED', 'TIMEOUT')
          AND j.updated_at >= ${from} AND j.updated_at <= ${to}`,
      this.prisma.printer.groupBy({
        by: ["status"],
        where: { shopId },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ active: number; out_of_stock: number; low: number }>>`
        SELECT
          (COUNT(*) FILTER (WHERE active))::int AS active,
          (COUNT(*) FILTER (WHERE active AND quantity = 0))::int AS out_of_stock,
          (COUNT(*) FILTER (WHERE active AND min_quantity > 0 AND quantity <= min_quantity))::int AS low
        FROM inventory_items WHERE shop_id = ${shopId}`,
      this.prisma.inventoryAlert.count({ where: { shopId, status: "OPEN" } }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { inventoryTrackingEnabled: true },
      }),
      this.prisma.$queryRaw<Array<{ blocked: number; failed: number; unresolved: number }>>`
        SELECT
          (COUNT(*) FILTER (WHERE j.status = 'WAITING' AND j.blocked_reason IS NOT NULL))::int AS blocked,
          (COUNT(*) FILTER (WHERE j.status IN ('FAILED', 'TIMEOUT')))::int AS failed,
          (COUNT(*) FILTER (WHERE j.status = 'UNKNOWN'))::int AS unresolved
        FROM print_jobs j
        JOIN orders o ON o.id = j.order_id
        WHERE j.shop_id = ${shopId}
          AND j.superseded_at IS NULL
          AND j.status IN ('WAITING', 'FAILED', 'TIMEOUT', 'UNKNOWN')
          AND o.order_status::text <> ALL(${TERMINAL_ORDER_STATUSES as string[]})`,
    ]);

    const currency = pickCurrency(
      revenue.map((row) => ({ currency: row.currency, amount: n(row.g_period) + n(row.g_today) })),
      undefined,
      settings?.currency ?? "PKR",
    );
    const money = revenue.find((row) => row.currency === currency);
    const byGroup = this.toGroups(periodByStatus, periodStranded);
    const currentGroups = this.toGroups(allByStatus, allStranded);
    const liveByStatus = new Map(liveJobs.map((row) => [row.status, row._count._all]));
    const printerByStatus: Record<string, number> = {};
    for (const row of printerRows) {
      printerByStatus[row.status] = row._count._all;
    }
    const printerTotal = Object.values(printerByStatus).reduce((a, b) => a + b, 0);
    const online = printerByStatus.ONLINE ?? 0;
    const offline = printerByStatus.OFFLINE ?? 0;
    const inv = inventory[0];
    const att = attention[0];

    return {
      shopId,
      generatedAt: now.toISOString(),
      range: { from: from.toISOString(), to: to.toISOString() },
      currency,
      orders: {
        today: todayCount,
        inPeriod: Object.values(periodByStatus).reduce((a, b) => a + b, 0),
        byStatus: periodByStatus,
        byGroup,
        current: {
          needsAttention: currentGroups.needsAttention,
          printing: currentGroups.printing,
          ready: currentGroups.ready,
        },
        pending: allByStatus[OrderStatus.WAITING_FOR_SHOP] ?? 0,
        completedInPeriod,
      },
      revenue: {
        currency,
        grossTodayMinor: n(money?.g_today),
        refundedTodayMinor: n(money?.r_today),
        netTodayMinor: n(money?.g_today) - n(money?.r_today),
        grossPeriodMinor: n(money?.g_period),
        refundedPeriodMinor: n(money?.r_period),
        netPeriodMinor: n(money?.g_period) - n(money?.r_period),
        paidOrdersInPeriod: n(money?.paid_orders),
      },
      printing: {
        printingNow: liveByStatus.get("PRINTING") ?? 0,
        waitingInQueue: QUEUE_STATUSES.reduce((sum, s) => sum + (liveByStatus.get(s) ?? 0), 0),
        jobsPrintedInPeriod: n(periodJobs[0]?.printed),
        pagesPrintedInPeriod: n(periodJobs[0]?.pages),
        jobsFailedInPeriod: n(periodJobs[0]?.failed),
      },
      printers: {
        total: printerTotal,
        online,
        offline,
        other: printerTotal - online - offline,
        byStatus: printerByStatus,
      },
      inventory: {
        trackingEnabled: trackingFlag?.inventoryTrackingEnabled ?? false,
        activeItems: n(inv?.active),
        lowStockCount: n(inv?.low),
        outOfStockCount: n(inv?.out_of_stock),
        openAlertCount: openAlerts,
      },
      attention: {
        blockedJobs: n(att?.blocked),
        failedJobs: n(att?.failed),
        unresolvedJobs: n(att?.unresolved),
        ordersNeedingAttention: currentGroups.needsAttention,
      },
    };
  }

  private toDashboardJob(row: JobRow): DashboardJob {
    const item = row.orderItem;
    const config = (item?.printConfiguration ?? row.order.printConfiguration) as {
      pages?: { mode: "all" } | { mode: "range"; from: number; to: number };
      copies?: number;
      paperSize?: string;
      paperType?: string;
      color?: string;
      sides?: string;
      orientation?: string;
      finishing?: string[];
    };
    const document = item?.document ?? row.order.document;
    const pages = jobPages(
      { pages: config.pages ?? { mode: "all" }, copies: config.copies },
      document?.pageCount,
      item?.quantity,
    );
    return {
      id: row.id,
      orderId: row.orderId,
      publicOrderNumber: row.order.publicOrderNumber,
      status: row.status,
      priority: row.priority,
      printerId: row.printerId,
      printerName: row.printer?.name ?? null,
      operatorId: row.operatorId,
      blockedReason: row.blockedReason,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      documentFilename: document?.filename ?? null,
      instructions: {
        paperSize: config.paperSize ?? null,
        paperType: config.paperType ?? null,
        color: config.color ?? null,
        sides: config.sides ?? null,
        orientation: config.orientation ?? null,
        copies: pages.copies,
        pagesPerCopy: pages.pagesPerCopy,
        totalPages: pages.total,
        finishing: config.finishing ?? [],
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async jobList(
    where: Prisma.PrintJobWhereInput,
    limit: number,
    orderBy: Prisma.PrintJobOrderByWithRelationInput[],
  ): Promise<{ total: number; items: DashboardJob[] }> {
    const [total, rows] = await Promise.all([
      this.prisma.printJob.count({ where }),
      this.prisma.printJob.findMany({ where, orderBy, take: limit, select: JOB_SELECT }),
    ]);
    return { total, items: rows.map((row) => this.toDashboardJob(row)) };
  }

  async operator(
    userId: string,
    query: OperatorDashboardQueryInput,
  ): Promise<OperatorDashboardResponse> {
    const { shopId, limit } = query;
    await this.assertMember(shopId, userId);
    const now = new Date();
    const live = { shopId, supersededAt: null } satisfies Prisma.PrintJobWhereInput;
    const byPriority: Prisma.PrintJobOrderByWithRelationInput[] = [
      { priority: "desc" },
      { createdAt: "asc" },
      { id: "asc" },
    ];
    const [current, mine, waiting, blocked, completed] = await Promise.all([
      this.jobList(
        { ...live, operatorId: userId, status: { in: ["CLAIMED", "PRINTING"] } },
        limit,
        byPriority,
      ),
      this.jobList(
        { ...live, operatorId: userId, status: { in: ["CREATED", "WAITING", "QUEUED", "PAUSED"] } },
        limit,
        byPriority,
      ),
      this.jobList(
        { ...live, operatorId: null, status: { in: ["CREATED", "QUEUED"] } },
        limit,
        byPriority,
      ),
      this.jobList({ ...live, status: "WAITING", blockedReason: { not: null } }, limit, byPriority),
      this.jobList(
        { ...live, operatorId: userId, status: "PRINTED", updatedAt: { gte: utcDayStart(now) } },
        limit,
        [{ updatedAt: "desc" }, { id: "asc" }],
      ),
    ]);
    return {
      shopId,
      userId,
      generatedAt: now.toISOString(),
      limit,
      currentJobs: current.items,
      myAssigned: mine,
      waiting,
      blocked,
      completedToday: completed,
    };
  }

  async printers(
    userId: string,
    query: ShopDashboardQueryInput,
  ): Promise<PrinterDashboardResponse> {
    const { shopId } = query;
    await this.assertMember(shopId, userId);
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);

    const [total, printers, shop, paperRows] = await Promise.all([
      this.prisma.printer.count({ where: { shopId } }),
      this.prisma.printer.findMany({
        where: { shopId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 200,
        include: { agent: { select: { id: true, status: true, lastSeenAt: true } } },
      }),
      this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { inventoryTrackingEnabled: true },
      }),
      this.prisma.$queryRaw<Array<{ paper_size: string; quantity: bigint; low: number }>>`
        SELECT paper_size,
               COALESCE(SUM(quantity), 0)::bigint AS quantity,
               (COUNT(*) FILTER (WHERE min_quantity > 0 AND quantity <= min_quantity))::int AS low
        FROM inventory_items
        WHERE shop_id = ${shopId} AND active AND paper_size IS NOT NULL
        GROUP BY paper_size ORDER BY paper_size`,
    ]);

    const ids = printers.map((printer) => printer.id);
    const periods = new Map(
      printers.map((printer) => [printer.id, periodStart(printer.pageLimitPeriod, now)]),
    );
    const [usageRows, currentJobs, queueRows, errorRows] =
      ids.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            this.prisma.printerPageUsage.findMany({
              where: {
                OR: printers.map((printer) => ({
                  printerId: printer.id,
                  periodStart: periods.get(printer.id)!,
                })),
              },
              select: { printerId: true, pagesUsed: true },
            }),
            this.prisma.printJob.findMany({
              where: {
                shopId,
                printerId: { in: ids },
                supersededAt: null,
                status: { in: ["CLAIMED", "PRINTING"] },
              },
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              select: {
                id: true,
                orderId: true,
                status: true,
                printerId: true,
                order: { select: { publicOrderNumber: true } },
              },
            }),
            this.prisma.$queryRaw<Array<{ printer_id: string; jobs: number; pages: bigint }>>`
              SELECT j.printer_id, COUNT(*)::int AS jobs, COALESCE(SUM(${JOB_TOTAL_PAGES}), 0)::bigint AS pages
              FROM print_jobs j
              ${JOB_PAGES_JOINS}
              WHERE j.shop_id = ${shopId}
                AND j.printer_id IN (${Prisma.join(ids)})
                AND j.superseded_at IS NULL
                AND j.status = 'QUEUED'
              GROUP BY j.printer_id`,
            this.prisma.$queryRaw<
              Array<{ printer_id: string; failed: number; last_reason: string | null }>
            >`
              SELECT j.printer_id,
                     COUNT(*)::int AS failed,
                     (array_agg(j.failure_reason::text ORDER BY j.updated_at DESC)
                        FILTER (WHERE j.failure_reason IS NOT NULL))[1] AS last_reason
              FROM print_jobs j
              WHERE j.shop_id = ${shopId}
                AND j.printer_id IN (${Prisma.join(ids)})
                AND j.status IN ('FAILED', 'TIMEOUT', 'UNKNOWN')
                AND j.updated_at >= ${since24h}
              GROUP BY j.printer_id`,
          ]);

    const usage = new Map(usageRows.map((row) => [row.printerId, row.pagesUsed]));
    const current = new Map<string, (typeof currentJobs)[number]>();
    for (const job of currentJobs) {
      if (job.printerId && !current.has(job.printerId)) {
        current.set(job.printerId, job);
      }
    }
    const queue = new Map(queueRows.map((row) => [row.printer_id, row]));
    const errors = new Map(errorRows.map((row) => [row.printer_id, row]));

    const items: DashboardPrinter[] = printers.map((printer) => {
      const pagesUsed = usage.get(printer.id) ?? 0;
      const lastSeen = printer.agent?.lastSeenAt ?? null;
      const currentJob = current.get(printer.id);
      const q = queue.get(printer.id);
      const e = errors.get(printer.id);
      return {
        id: printer.id,
        name: printer.name,
        status: printer.status,
        lastStatusAt: printer.lastStatusAt?.toISOString() ?? null,
        agent: printer.agent
          ? {
              id: printer.agent.id,
              status: printer.agent.status,
              lastSeenAt: lastSeen?.toISOString() ?? null,
            }
          : null,
        offline:
          printer.status === "OFFLINE" ||
          (lastSeen !== null && now.getTime() - lastSeen.getTime() > MISSED_HEARTBEAT_MS),
        maintenanceStatus: printer.maintenanceStatus,
        currentJob: currentJob
          ? {
              id: currentJob.id,
              orderId: currentJob.orderId,
              publicOrderNumber: currentJob.order.publicOrderNumber,
              status: currentJob.status,
            }
          : null,
        queue: { jobs: n(q?.jobs), pages: n(q?.pages) },
        pageLimit: {
          enabled: printer.pageLimitEnabled,
          limit: printer.pageLimit,
          period: printer.pageLimitPeriod,
          periodStart: periods.get(printer.id)!.toISOString(),
          pagesUsed,
          remaining:
            printer.pageLimitEnabled && printer.pageLimit !== null
              ? Math.max(0, printer.pageLimit - pagesUsed)
              : null,
        },
        errors: { failedJobs24h: n(e?.failed), lastFailureReason: e?.last_reason ?? null },
      };
    });

    return {
      shopId,
      generatedAt: now.toISOString(),
      total,
      items,
      paper: {
        trackingEnabled: shop?.inventoryTrackingEnabled ?? false,
        bySize: paperRows.map((row) => ({
          paperSize: row.paper_size,
          quantity: n(row.quantity),
          lowStockItems: n(row.low),
        })),
      },
    };
  }
}
