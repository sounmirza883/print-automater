/** 23.5 (PRD 72-74): the documented response shapes of the report endpoints
 * `GET /v1/shop/reports/<name>` (permission VIEW_REPORTS: owner and manager).
 *
 * Conventions shared by every report:
 * - Query: `shopId`, optional `from` / `to` (ISO dates, default: the last 30 days, at
 *   most 366 days, `from` before `to`), `groupBy=day|week|month` (default `day`; only the
 *   time-series reports use it), `format=json|csv` (default `json`).
 * - Time is UTC. A "day" starts 00:00 UTC, a "week" on Monday, a "month" on the 1st.
 *   Every bucket in the range is present (zero rows are filled in) and labelled with
 *   the bucket's first day as `YYYY-MM-DD`.
 * - Money is integer minor units, reported in ONE currency (`currency`): the `currency` query
 *   param, else the currency with the most money in the range, else the shop's configured one.
 *   Revenue comes from payments (amounts snapshotted from each order's own quote: a later
 *   price change never alters a past figure); see RevenueReportRow for the exact definition.
 * - Lists per subject (printers, operators, suppliers, items) are bounded at 200 rows;
 *   `truncated` says whether more existed.
 * - `format=csv` returns `text/csv` of the `rows` only (nested objects flattened as
 *   `parent.child`), with cells that could be read as spreadsheet formulas escaped. */
export type ReportGroupBy = "day" | "week" | "month";

export interface ReportEnvelope<Row, Totals> {
  shopId: string;
  report: string;
  generatedAt: string;
  range: { from: string; to: string };
  /** null for reports that are per subject rather than a time series. */
  groupBy: ReportGroupBy | null;
  currency: string;
  rows: Row[];
  totals: Totals;
  truncated: boolean;
}

export interface OrdersReportRow {
  bucket: string;
  /** Orders created in the bucket that the shop can see (not draft / unpaid). */
  total: number;
  completed: number;
  cancelled: number;
  rejected: number;
  printFailed: number;
  /** Everything else still open. */
  open: number;
  /** Sum of the price-snapshot quote totals of ALL these orders, whatever became of them
   * (cancelled, rejected, failed, still unpaid): what was quoted, not what was earned. In the
   * report currency only; never a live pricing rule. */
  quotedValueMinor: number;
  /** The same sum over only the orders that were actually paid (payment status PAID, or a
   * refund state, which can only follow PAID). Gross of refunds: see the revenue report for
   * money actually kept. */
  paidValueMinor: number;
}
export type OrdersReportTotals = Omit<OrdersReportRow, "bucket">;

/** 23.10: revenue, defined explicitly (all of it in the report's single `currency`; money is
 * never summed across currencies).
 *  - grossRevenueMinor: payments that were EVER paid (PAID, or a refund state, which can only
 *    follow PAID), dated by the payment's STABLE paidAt (stamped once, never moved by a later
 *    refund or touch of the row).
 *  - refundedMinor: refunds that COMPLETED (status REFUNDED), from the refunds table (the
 *    refund's own amount), dated by when the refund completed. REFUND_PENDING and
 *    REFUND_FAILED are NOT refunded: the money has not gone back yet, so it stays in net.
 *  - netRevenueMinor = grossRevenueMinor - refundedMinor. A bucket can be negative when it
 *    refunds more than it took. Do not subtract refundedMinor from grossRevenueMinor again. */
export interface RevenueReportRow {
  bucket: string;
  grossRevenueMinor: number;
  paidOrders: number;
  refundedMinor: number;
  refundedOrders: number;
  netRevenueMinor: number;
}
export interface RevenueReportTotals extends Omit<RevenueReportRow, "bucket"> {
  /** Money in the range in currencies other than the report currency, kept apart, never
   * converted. Empty for a single-currency shop. */
  otherCurrencies: Array<{
    currency: string;
    grossRevenueMinor: number;
    refundedMinor: number;
    netRevenueMinor: number;
  }>;
}

export interface PrintingVolumeReportRow {
  bucket: string;
  jobsPrinted: number;
  /** Resolved pages x copies of the jobs that reached PRINTED. */
  pagesPrinted: number;
  colorPages: number;
  bwPages: number;
}
export interface PrintingVolumeReportTotals extends Omit<PrintingVolumeReportRow, "bucket"> {
  byPaperSize: Array<{ paperSize: string; pages: number }>;
}

export interface PrinterUsageReportRow {
  printerId: string;
  name: string;
  status: string;
  jobsCompleted: number;
  /** Jobs that ended FAILED or TIMEOUT. */
  jobsFailed: number;
  /** Jobs left UNKNOWN (paper may have come out; staff resolve them). */
  jobsUnknown: number;
  pagesPrinted: number;
  /** Mean seconds from claim to completion of the printed jobs; null with none. */
  avgJobDurationSeconds: number | null;
  /** No printer status history is recorded, so downtime cannot be derived. Always null. */
  downtimeSeconds: null;
  /** The printer's CURRENT period allowance (not the report range). */
  pageLimit: {
    enabled: boolean;
    limit: number | null;
    period: string;
    pagesUsedInPeriod: number;
    remaining: number | null;
  };
}
export interface PrinterUsageReportTotals {
  jobsCompleted: number;
  jobsFailed: number;
  jobsUnknown: number;
  pagesPrinted: number;
}

/** §74: DESCRIPTIVE only. The rows are listed alphabetically by name, carry no
 * comparison or evaluation fields, and `notice` must be shown with the report. */
export interface OperatorWorkloadReportRow {
  operatorId: string;
  name: string;
  jobsAssigned: number;
  jobsCompleted: number;
  jobsFailed: number;
  /** Mean seconds from claim to completion of their printed jobs; null with none. */
  avgCompletionSeconds: number | null;
  /** Jobs assigned to them right now that are not finished. */
  currentAssignedJobs: number;
}
export interface OperatorWorkloadReportTotals {
  jobsAssigned: number;
  jobsCompleted: number;
  jobsFailed: number;
  currentAssignedJobs: number;
  /** Fixed text. */
  notice: string;
}

export interface PaperConsumptionReportRow {
  inventoryItemId: string;
  name: string;
  paperSize: string | null;
  paperType: string | null;
  /** Sheets drawn down by CONSUMPTION movements in the range. */
  sheetsConsumed: number;
  movements: number;
}
export interface PaperConsumptionReportTotals {
  sheetsConsumed: number;
  series: Array<{ bucket: string; sheets: number }>;
}

export interface SupplierPurchasesReportRow {
  supplierId: string;
  name: string;
  purchaseOrders: number;
  received: number;
  cancelled: number;
  /** Cost of the non-cancelled purchase orders created in the range. */
  totalCostMinor: number;
}
export interface SupplierPurchasesReportTotals {
  purchaseOrders: number;
  received: number;
  cancelled: number;
  totalCostMinor: number;
  series: Array<{ bucket: string; purchaseOrders: number; totalCostMinor: number }>;
}

export const OPERATOR_WORKLOAD_NOTICE =
  "Counts describe recorded job activity only and are listed alphabetically by name.";

export type OrdersReport = ReportEnvelope<OrdersReportRow, OrdersReportTotals>;
export type RevenueReport = ReportEnvelope<RevenueReportRow, RevenueReportTotals>;
export type PrintingVolumeReport = ReportEnvelope<
  PrintingVolumeReportRow,
  PrintingVolumeReportTotals
>;
export type PrinterUsageReport = ReportEnvelope<PrinterUsageReportRow, PrinterUsageReportTotals>;
export type OperatorWorkloadReport = ReportEnvelope<
  OperatorWorkloadReportRow,
  OperatorWorkloadReportTotals
>;
export type PaperConsumptionReport = ReportEnvelope<
  PaperConsumptionReportRow,
  PaperConsumptionReportTotals
>;
export type SupplierPurchasesReport = ReportEnvelope<
  SupplierPurchasesReportRow,
  SupplierPurchasesReportTotals
>;
