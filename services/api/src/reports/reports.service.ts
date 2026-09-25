import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  OPERATOR_WORKLOAD_NOTICE,
  type OperatorWorkloadReport,
  type OrdersReport,
  type PaperConsumptionReport,
  type PrinterUsageReport,
  type PrintingVolumeReport,
  type ReportEnvelope,
  type ReportGroupBy,
  type RevenueReport,
  type SupplierPurchasesReport,
} from "@print-automated/types";
import { periodStart, PrismaService } from "@print-automated/backend-shared";
import { DEFAULT_REPORT_RANGE_DAYS, type ReportQueryInput } from "@print-automated/validation";
import { JOB_PAGES_JOINS, JOB_TOTAL_PAGES } from "../analytics/job-pages-sql.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { SHOP_VISIBLE_STATUSES } from "../shop-orders/shop-orders.service.js";
import { bucketKeys } from "./buckets.js";

const DAY_MS = 86_400_000;
/** Per-subject lists (printers, operators, suppliers, items) never exceed this. */
export const REPORT_ROW_LIMIT = 200;

const n = (value: unknown): number => Number(value ?? 0);

interface Range {
  from: Date;
  to: Date;
}

/** 23.5 (PRD 72-74): shop reports. Every query is scoped by the caller's proven shop
 * membership and the requested (bounded) range, and is a SQL aggregate: time series are
 * `GROUP BY date_trunc(...)` with zero buckets filled in afterwards, per-subject lists
 * are capped at REPORT_ROW_LIMIT. Money is never derived from a live pricing rule:
 * revenue is the sum of confirmed payments and order value the sum of price snapshots. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  private async open(
    userId: string,
    query: ReportQueryInput,
  ): Promise<{ range: Range; currency: string; shopId: string }> {
    const { shopId } = query;
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's reports.");
    }
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_REPORT_RANGE_DAYS * DAY_MS);
    const settings = await this.prisma.shopSettings.findUnique({
      where: { shopId },
      select: { currency: true },
    });
    return { range: { from, to }, currency: settings?.currency ?? "PKR", shopId };
  }

  private envelope<Row, Totals>(
    name: string,
    ctx: { range: Range; currency: string; shopId: string },
    groupBy: ReportGroupBy | null,
    rows: Row[],
    totals: Totals,
    truncated = false,
  ): ReportEnvelope<Row, Totals> {
    return {
      shopId: ctx.shopId,
      report: name,
      generatedAt: new Date().toISOString(),
      range: { from: ctx.range.from.toISOString(), to: ctx.range.to.toISOString() },
      groupBy,
      currency: ctx.currency,
      rows,
      totals,
      truncated,
    };
  }

  async orders(userId: string, query: ReportQueryInput): Promise<OrdersReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const found = await this.prisma.$queryRaw<
      Array<{
        bucket: string;
        total: number;
        completed: number;
        cancelled: number;
        rejected: number;
        print_failed: number;
        value: bigint;
      }>
    >`
      SELECT to_char(date_trunc(${query.groupBy}, o.created_at), 'YYYY-MM-DD') AS bucket,
        COUNT(*)::int AS total,
        (COUNT(*) FILTER (WHERE o.order_status = 'COMPLETED'))::int AS completed,
        (COUNT(*) FILTER (WHERE o.order_status = 'CANCELLED'))::int AS cancelled,
        (COUNT(*) FILTER (WHERE o.order_status = 'SHOP_REJECTED'))::int AS rejected,
        (COUNT(*) FILTER (WHERE o.order_status = 'PRINT_FAILED'))::int AS print_failed,
        COALESCE(SUM(
          CASE WHEN (o.pricing_snapshot->'quote'->>'totalMinor') ~ '^[0-9]+$'
               THEN (o.pricing_snapshot->'quote'->>'totalMinor')::bigint END
        ), 0)::bigint AS value
      FROM orders o
      WHERE o.shop_id = ${ctx.shopId}
        AND o.order_status::text = ANY(${SHOP_VISIBLE_STATUSES as string[]})
        AND o.created_at >= ${from} AND o.created_at <= ${to}
      GROUP BY 1`;
    const byBucket = new Map(found.map((row) => [row.bucket, row]));
    const rows = bucketKeys(from, to, query.groupBy).map((bucket) => {
      const row = byBucket.get(bucket);
      const total = n(row?.total);
      const completed = n(row?.completed);
      const cancelled = n(row?.cancelled);
      const rejected = n(row?.rejected);
      const printFailed = n(row?.print_failed);
      return {
        bucket,
        total,
        completed,
        cancelled,
        rejected,
        printFailed,
        open: total - completed - cancelled - rejected - printFailed,
        valueMinor: n(row?.value),
      };
    });
    const totals = rows.reduce(
      (acc, row) => ({
        total: acc.total + row.total,
        completed: acc.completed + row.completed,
        cancelled: acc.cancelled + row.cancelled,
        rejected: acc.rejected + row.rejected,
        printFailed: acc.printFailed + row.printFailed,
        open: acc.open + row.open,
        valueMinor: acc.valueMinor + row.valueMinor,
      }),
      { total: 0, completed: 0, cancelled: 0, rejected: 0, printFailed: 0, open: 0, valueMinor: 0 },
    );
    return this.envelope("orders", ctx, query.groupBy, rows, totals);
  }

  async revenue(userId: string, query: ReportQueryInput): Promise<RevenueReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const found = await this.prisma.$queryRaw<
      Array<{
        bucket: string;
        revenue: bigint;
        paid_orders: number;
        refunded: bigint;
        refunded_orders: number;
      }>
    >`
      SELECT to_char(date_trunc(${query.groupBy}, p.updated_at), 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'PAID'), 0)::bigint AS revenue,
        (COUNT(DISTINCT p.order_id) FILTER (WHERE p.status = 'PAID'))::int AS paid_orders,
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'REFUNDED'), 0)::bigint AS refunded,
        (COUNT(DISTINCT p.order_id) FILTER (WHERE p.status = 'REFUNDED'))::int AS refunded_orders
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE o.shop_id = ${ctx.shopId}
        AND p.status IN ('PAID', 'REFUNDED')
        AND p.updated_at >= ${from} AND p.updated_at <= ${to}
      GROUP BY 1`;
    const byBucket = new Map(found.map((row) => [row.bucket, row]));
    const rows = bucketKeys(from, to, query.groupBy).map((bucket) => {
      const row = byBucket.get(bucket);
      return {
        bucket,
        revenueMinor: n(row?.revenue),
        paidOrders: n(row?.paid_orders),
        refundedMinor: n(row?.refunded),
        refundedOrders: n(row?.refunded_orders),
      };
    });
    const totals = rows.reduce(
      (acc, row) => ({
        revenueMinor: acc.revenueMinor + row.revenueMinor,
        // an order paid in two buckets cannot occur (one PAID payment per order)
        paidOrders: acc.paidOrders + row.paidOrders,
        refundedMinor: acc.refundedMinor + row.refundedMinor,
        refundedOrders: acc.refundedOrders + row.refundedOrders,
      }),
      { revenueMinor: 0, paidOrders: 0, refundedMinor: 0, refundedOrders: 0 },
    );
    return this.envelope("revenue", ctx, query.groupBy, rows, totals);
  }

  async printingVolume(userId: string, query: ReportQueryInput): Promise<PrintingVolumeReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const config = Prisma.sql`COALESCE(oi.print_configuration, o.print_configuration)`;
    const [found, bySize] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: string; jobs: number; pages: bigint; color: bigint }>>`
        SELECT to_char(date_trunc(${query.groupBy}, j.updated_at), 'YYYY-MM-DD') AS bucket,
          COUNT(*)::int AS jobs,
          COALESCE(SUM(${JOB_TOTAL_PAGES}), 0)::bigint AS pages,
          COALESCE(SUM(${JOB_TOTAL_PAGES}) FILTER (WHERE ${config}->>'color' = 'COLOR'), 0)::bigint AS color
        FROM print_jobs j
        ${JOB_PAGES_JOINS}
        WHERE j.shop_id = ${ctx.shopId} AND j.status = 'PRINTED'
          AND j.updated_at >= ${from} AND j.updated_at <= ${to}
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ paper_size: string | null; pages: bigint }>>`
        SELECT ${config}->>'paperSize' AS paper_size, COALESCE(SUM(${JOB_TOTAL_PAGES}), 0)::bigint AS pages
        FROM print_jobs j
        ${JOB_PAGES_JOINS}
        WHERE j.shop_id = ${ctx.shopId} AND j.status = 'PRINTED'
          AND j.updated_at >= ${from} AND j.updated_at <= ${to}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const byBucket = new Map(found.map((row) => [row.bucket, row]));
    const rows = bucketKeys(from, to, query.groupBy).map((bucket) => {
      const row = byBucket.get(bucket);
      const pagesPrinted = n(row?.pages);
      const colorPages = n(row?.color);
      return {
        bucket,
        jobsPrinted: n(row?.jobs),
        pagesPrinted,
        colorPages,
        bwPages: pagesPrinted - colorPages,
      };
    });
    const totals = {
      ...rows.reduce(
        (acc, row) => ({
          jobsPrinted: acc.jobsPrinted + row.jobsPrinted,
          pagesPrinted: acc.pagesPrinted + row.pagesPrinted,
          colorPages: acc.colorPages + row.colorPages,
          bwPages: acc.bwPages + row.bwPages,
        }),
        { jobsPrinted: 0, pagesPrinted: 0, colorPages: 0, bwPages: 0 },
      ),
      byPaperSize: bySize.map((row) => ({
        paperSize: row.paper_size ?? "UNKNOWN",
        pages: n(row.pages),
      })),
    };
    return this.envelope("printing-volume", ctx, query.groupBy, rows, totals);
  }

  async printers(userId: string, query: ReportQueryInput): Promise<PrinterUsageReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const now = new Date();
    const [printers, agg] = await Promise.all([
      this.prisma.printer.findMany({
        where: { shopId: ctx.shopId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: REPORT_ROW_LIMIT + 1,
      }),
      this.prisma.$queryRaw<
        Array<{
          printer_id: string;
          completed: number;
          failed: number;
          unknown: number;
          pages: bigint;
          avg_seconds: number | null;
        }>
      >`
        SELECT j.printer_id,
          (COUNT(*) FILTER (WHERE j.status = 'PRINTED'))::int AS completed,
          (COUNT(*) FILTER (WHERE j.status IN ('FAILED', 'TIMEOUT')))::int AS failed,
          (COUNT(*) FILTER (WHERE j.status = 'UNKNOWN'))::int AS unknown,
          COALESCE(SUM(${JOB_TOTAL_PAGES}) FILTER (WHERE j.status = 'PRINTED'), 0)::bigint AS pages,
          ROUND(AVG(EXTRACT(EPOCH FROM (j.updated_at - j.claimed_at)))
            FILTER (WHERE j.status = 'PRINTED' AND j.claimed_at IS NOT NULL))::int AS avg_seconds
        FROM print_jobs j
        ${JOB_PAGES_JOINS}
        WHERE j.shop_id = ${ctx.shopId}
          AND j.printer_id IS NOT NULL
          AND j.status IN ('PRINTED', 'FAILED', 'TIMEOUT', 'UNKNOWN')
          AND j.updated_at >= ${from} AND j.updated_at <= ${to}
        GROUP BY j.printer_id`,
    ]);
    const truncated = printers.length > REPORT_ROW_LIMIT;
    const shown = printers.slice(0, REPORT_ROW_LIMIT);
    const usage = shown.length
      ? await this.prisma.printerPageUsage.findMany({
          where: {
            OR: shown.map((printer) => ({
              printerId: printer.id,
              periodStart: periodStart(printer.pageLimitPeriod, now),
            })),
          },
          select: { printerId: true, pagesUsed: true },
        })
      : [];
    const used = new Map(usage.map((row) => [row.printerId, row.pagesUsed]));
    const stats = new Map(agg.map((row) => [row.printer_id, row]));
    const rows = shown.map((printer) => {
      const s = stats.get(printer.id);
      const pagesUsedInPeriod = used.get(printer.id) ?? 0;
      return {
        printerId: printer.id,
        name: printer.name,
        status: printer.status,
        jobsCompleted: n(s?.completed),
        jobsFailed: n(s?.failed),
        jobsUnknown: n(s?.unknown),
        pagesPrinted: n(s?.pages),
        avgJobDurationSeconds: s?.avg_seconds ?? null,
        downtimeSeconds: null,
        pageLimit: {
          enabled: printer.pageLimitEnabled,
          limit: printer.pageLimit,
          period: printer.pageLimitPeriod,
          pagesUsedInPeriod,
          remaining:
            printer.pageLimitEnabled && printer.pageLimit !== null
              ? Math.max(0, printer.pageLimit - pagesUsedInPeriod)
              : null,
        },
      };
    });
    const totals = rows.reduce(
      (acc, row) => ({
        jobsCompleted: acc.jobsCompleted + row.jobsCompleted,
        jobsFailed: acc.jobsFailed + row.jobsFailed,
        jobsUnknown: acc.jobsUnknown + row.jobsUnknown,
        pagesPrinted: acc.pagesPrinted + row.pagesPrinted,
      }),
      { jobsCompleted: 0, jobsFailed: 0, jobsUnknown: 0, pagesPrinted: 0 },
    );
    return this.envelope("printers", ctx, null, rows, totals, truncated);
  }

  /** §74: descriptive counts only. Rows are ordered alphabetically by name (never by
   * any measure of activity), and no comparative or evaluative field exists. */
  async operatorWorkload(userId: string, query: ReportQueryInput): Promise<OperatorWorkloadReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const found = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        assigned: number;
        completed: number;
        failed: number;
        avg_seconds: number | null;
        current: number;
      }>
    >`
      WITH agg AS (
        SELECT j.operator_id,
          (COUNT(*) FILTER (WHERE j.created_at >= ${from} AND j.created_at <= ${to}))::int AS assigned,
          (COUNT(*) FILTER (WHERE j.status = 'PRINTED' AND j.updated_at >= ${from} AND j.updated_at <= ${to}))::int AS completed,
          (COUNT(*) FILTER (WHERE j.status IN ('FAILED', 'TIMEOUT') AND j.updated_at >= ${from} AND j.updated_at <= ${to}))::int AS failed,
          ROUND(AVG(EXTRACT(EPOCH FROM (j.updated_at - j.claimed_at)))
            FILTER (WHERE j.status = 'PRINTED' AND j.claimed_at IS NOT NULL
                    AND j.updated_at >= ${from} AND j.updated_at <= ${to}))::int AS avg_seconds,
          (COUNT(*) FILTER (WHERE j.superseded_at IS NULL
                    AND j.status IN ('CREATED', 'WAITING', 'QUEUED', 'CLAIMED', 'PRINTING', 'PAUSED')))::int AS current
        FROM print_jobs j
        WHERE j.shop_id = ${ctx.shopId}
          AND j.operator_id IS NOT NULL
          AND (j.created_at >= ${from} OR j.updated_at >= ${from}
               OR j.status IN ('CREATED', 'WAITING', 'QUEUED', 'CLAIMED', 'PRINTING', 'PAUSED'))
        GROUP BY j.operator_id
      )
      SELECT u.id, u.name,
        COALESCE(a.assigned, 0)::int AS assigned,
        COALESCE(a.completed, 0)::int AS completed,
        COALESCE(a.failed, 0)::int AS failed,
        a.avg_seconds,
        COALESCE(a.current, 0)::int AS current
      FROM users u
      LEFT JOIN agg a ON a.operator_id = u.id
      WHERE u.id IN (SELECT operator_id FROM agg)
         OR u.id IN (SELECT s.user_id FROM shop_staff s
                     WHERE s.shop_id = ${ctx.shopId} AND s.status = 'ACTIVE' AND s.role = 'OPERATOR')
      ORDER BY lower(u.name), u.id
      LIMIT ${REPORT_ROW_LIMIT + 1}`;
    const truncated = found.length > REPORT_ROW_LIMIT;
    const rows = found.slice(0, REPORT_ROW_LIMIT).map((row) => ({
      operatorId: row.id,
      name: row.name,
      jobsAssigned: n(row.assigned),
      jobsCompleted: n(row.completed),
      jobsFailed: n(row.failed),
      avgCompletionSeconds: row.avg_seconds ?? null,
      currentAssignedJobs: n(row.current),
    }));
    const totals = {
      ...rows.reduce(
        (acc, row) => ({
          jobsAssigned: acc.jobsAssigned + row.jobsAssigned,
          jobsCompleted: acc.jobsCompleted + row.jobsCompleted,
          jobsFailed: acc.jobsFailed + row.jobsFailed,
          currentAssignedJobs: acc.currentAssignedJobs + row.currentAssignedJobs,
        }),
        { jobsAssigned: 0, jobsCompleted: 0, jobsFailed: 0, currentAssignedJobs: 0 },
      ),
      notice: OPERATOR_WORKLOAD_NOTICE,
    };
    return this.envelope("operator-workload", ctx, null, rows, totals, truncated);
  }

  async paperConsumption(userId: string, query: ReportQueryInput): Promise<PaperConsumptionReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const [items, series] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          paper_size: string | null;
          paper_type: string | null;
          sheets: bigint;
          movements: number;
        }>
      >`
        SELECT i.id, i.name, i.paper_size, i.paper_type,
          (-SUM(m.quantity_delta))::bigint AS sheets, COUNT(*)::int AS movements
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.inventory_item_id AND i.shop_id = m.shop_id
        WHERE m.shop_id = ${ctx.shopId} AND m.type = 'CONSUMPTION'
          AND m.created_at >= ${from} AND m.created_at <= ${to}
        GROUP BY i.id, i.name, i.paper_size, i.paper_type
        ORDER BY lower(i.name), i.id
        LIMIT ${REPORT_ROW_LIMIT + 1}`,
      this.prisma.$queryRaw<Array<{ bucket: string; sheets: bigint }>>`
        SELECT to_char(date_trunc(${query.groupBy}, m.created_at), 'YYYY-MM-DD') AS bucket,
          (-SUM(m.quantity_delta))::bigint AS sheets
        FROM inventory_movements m
        WHERE m.shop_id = ${ctx.shopId} AND m.type = 'CONSUMPTION'
          AND m.created_at >= ${from} AND m.created_at <= ${to}
        GROUP BY 1`,
    ]);
    const truncated = items.length > REPORT_ROW_LIMIT;
    const rows = items.slice(0, REPORT_ROW_LIMIT).map((row) => ({
      inventoryItemId: row.id,
      name: row.name,
      paperSize: row.paper_size,
      paperType: row.paper_type,
      sheetsConsumed: n(row.sheets),
      movements: n(row.movements),
    }));
    const byBucket = new Map(series.map((row) => [row.bucket, n(row.sheets)]));
    const seriesRows = bucketKeys(from, to, query.groupBy).map((bucket) => ({
      bucket,
      sheets: byBucket.get(bucket) ?? 0,
    }));
    return this.envelope(
      "paper-consumption",
      ctx,
      query.groupBy,
      rows,
      {
        sheetsConsumed: seriesRows.reduce((sum, row) => sum + row.sheets, 0),
        series: seriesRows,
      },
      truncated,
    );
  }

  async supplierPurchases(
    userId: string,
    query: ReportQueryInput,
  ): Promise<SupplierPurchasesReport> {
    const ctx = await this.open(userId, query);
    const { from, to } = ctx.range;
    const [suppliers, series] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          pos: number;
          received: number;
          cancelled: number;
          cost: bigint;
        }>
      >`
        SELECT s.id, s.name,
          COUNT(po.id)::int AS pos,
          (COUNT(*) FILTER (WHERE po.status = 'RECEIVED'))::int AS received,
          (COUNT(*) FILTER (WHERE po.status = 'CANCELLED'))::int AS cancelled,
          COALESCE(SUM(po.total_cost_minor) FILTER (WHERE po.status <> 'CANCELLED'), 0)::bigint AS cost
        FROM purchase_orders po
        JOIN suppliers s ON s.id = po.supplier_id AND s.shop_id = po.shop_id
        WHERE po.shop_id = ${ctx.shopId}
          AND po.created_at >= ${from} AND po.created_at <= ${to}
        GROUP BY s.id, s.name
        ORDER BY lower(s.name), s.id
        LIMIT ${REPORT_ROW_LIMIT + 1}`,
      this.prisma.$queryRaw<Array<{ bucket: string; pos: number; cost: bigint }>>`
        SELECT to_char(date_trunc(${query.groupBy}, po.created_at), 'YYYY-MM-DD') AS bucket,
          COUNT(*)::int AS pos,
          COALESCE(SUM(po.total_cost_minor) FILTER (WHERE po.status <> 'CANCELLED'), 0)::bigint AS cost
        FROM purchase_orders po
        WHERE po.shop_id = ${ctx.shopId}
          AND po.created_at >= ${from} AND po.created_at <= ${to}
        GROUP BY 1`,
    ]);
    const truncated = suppliers.length > REPORT_ROW_LIMIT;
    const rows = suppliers.slice(0, REPORT_ROW_LIMIT).map((row) => ({
      supplierId: row.id,
      name: row.name,
      purchaseOrders: n(row.pos),
      received: n(row.received),
      cancelled: n(row.cancelled),
      totalCostMinor: n(row.cost),
    }));
    const byBucket = new Map(series.map((row) => [row.bucket, row]));
    const seriesRows = bucketKeys(from, to, query.groupBy).map((bucket) => ({
      bucket,
      purchaseOrders: n(byBucket.get(bucket)?.pos),
      totalCostMinor: n(byBucket.get(bucket)?.cost),
    }));
    const totals = {
      ...seriesRows.reduce(
        (acc, row) => ({
          purchaseOrders: acc.purchaseOrders + row.purchaseOrders,
          totalCostMinor: acc.totalCostMinor + row.totalCostMinor,
        }),
        { purchaseOrders: 0, totalCostMinor: 0 },
      ),
      received: rows.reduce((sum, row) => sum + row.received, 0),
      cancelled: rows.reduce((sum, row) => sum + row.cancelled, 0),
      series: seriesRows,
    };
    return this.envelope("supplier-purchases", ctx, query.groupBy, rows, totals, truncated);
  }
}
