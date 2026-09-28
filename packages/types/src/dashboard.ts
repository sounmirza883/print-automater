/** 23.2 (PRD 39-42): the documented response shapes of the dashboard aggregate
 * endpoints. Every value is computed server-side by SQL aggregates scoped to ONE
 * shop (or, for the admin dashboard, the platform); nothing here is derived from
 * an unbounded row load. Dates are ISO-8601 strings on the wire. Money is integer
 * minor units in `currency`. */

/** The five groups the shop-orders list already uses (shop-orders.service GROUP_BY_STATUS),
 * with the same "stranded job means needsAttention" refinement. */
export interface DashboardOrderGroups {
  needsAttention: number;
  printing: number;
  ready: number;
  completed: number;
  failed: number;
}

/** `GET /v1/shop/dashboard/owner?shopId&from&to` (VIEW_DASHBOARD). */
export interface OwnerDashboardResponse {
  shopId: string;
  generatedAt: string;
  /** The reporting period for every "period" figure. Defaults to the last 7 UTC days. */
  range: { from: string; to: string };
  currency: string;
  orders: {
    /** Orders the shop can see (not draft / unpaid) created since 00:00 UTC today. */
    today: number;
    /** Orders created inside `range`. */
    inPeriod: number;
    /** Orders created inside `range`, by raw order status (only non-zero keys). */
    byStatus: Record<string, number>;
    /** Orders created inside `range`, by list group. */
    byGroup: DashboardOrderGroups;
    /** Live right now, whatever their age: what the floor still has to deal with. */
    current: { needsAttention: number; printing: number; ready: number };
    /** Orders waiting for the shop to accept them (WAITING_FOR_SHOP). */
    pending: number;
    /** Orders completed inside `range` (by completedAt). */
    completedInPeriod: number;
  };
  /** 23.10: same definitions as the revenue report (see RevenueReportRow in reports.ts), in
   * ONE currency: gross = payments ever paid, dated by their stable paidAt; refunded =
   * COMPLETED refunds (their own amount) dated by completion; net = gross - refunded.
   * REFUND_PENDING / REFUND_FAILED are not refunded. "today" is since 00:00 UTC. */
  revenue: {
    currency: string;
    grossTodayMinor: number;
    refundedTodayMinor: number;
    netTodayMinor: number;
    grossPeriodMinor: number;
    refundedPeriodMinor: number;
    netPeriodMinor: number;
    paidOrdersInPeriod: number;
  };
  printing: {
    printingNow: number;
    /** Live jobs waiting to be printed: CREATED, WAITING, QUEUED. */
    waitingInQueue: number;
    jobsPrintedInPeriod: number;
    /** Resolved pages x copies of the jobs printed in `range`. */
    pagesPrintedInPeriod: number;
    jobsFailedInPeriod: number;
  };
  printers: {
    total: number;
    online: number;
    offline: number;
    /** Every other status (ERROR, DISABLED, MAINTENANCE, PAUSED, UNKNOWN, BUSY). */
    other: number;
    byStatus: Record<string, number>;
  };
  inventory: {
    trackingEnabled: boolean;
    activeItems: number;
    lowStockCount: number;
    outOfStockCount: number;
    openAlertCount: number;
  };
  attention: {
    /** Live jobs parked WAITING with a blockedReason. */
    blockedJobs: number;
    /** Live jobs in FAILED or TIMEOUT (a human has to retry or resolve). */
    failedJobs: number;
    /** Live jobs in UNKNOWN (paper may have come out; staff must resolve). */
    unresolvedJobs: number;
    ordersNeedingAttention: number;
  };
}

/** One job as the operator dashboard shows it. */
export interface DashboardJob {
  id: string;
  orderId: string;
  publicOrderNumber: string;
  status: string;
  /** `JobPriority` scale: 0 normal, 10 high, 20 urgent. */
  priority: number;
  printerId: string | null;
  printerName: string | null;
  operatorId: string | null;
  blockedReason: string | null;
  pausedAt: string | null;
  documentFilename: string | null;
  /** The job's print instructions (what to load and how to print). */
  instructions: {
    paperSize: string | null;
    paperType: string | null;
    color: string | null;
    sides: string | null;
    orientation: string | null;
    copies: number;
    pagesPerCopy: number;
    totalPages: number;
    finishing: string[];
  };
  createdAt: string;
  updatedAt: string;
}

/** `GET /v1/shop/dashboard/operator?shopId` (VIEW_OPERATOR_DASHBOARD). "My" is the
 * calling user. Every list is capped (`limit` per list, newest/highest priority first)
 * and comes with its full count. */
export interface OperatorDashboardResponse {
  shopId: string;
  userId: string;
  generatedAt: string;
  limit: number;
  /** Jobs assigned to me that are CLAIMED / PRINTING right now. */
  currentJobs: DashboardJob[];
  /** Jobs assigned to me that are queued, waiting or paused. */
  myAssigned: { total: number; items: DashboardJob[] };
  /** Live, unassigned-to-anyone-else jobs waiting to be picked up (QUEUED / CREATED). */
  waiting: { total: number; items: DashboardJob[] };
  /** Shop-wide live jobs parked WAITING with a blockedReason (why is in the item). */
  blocked: { total: number; items: DashboardJob[] };
  /** Jobs I completed today (UTC). */
  completedToday: { total: number; items: DashboardJob[] };
}

export interface DashboardPrinter {
  id: string;
  name: string;
  status: string;
  lastStatusAt: string | null;
  /** Agent heartbeat: null when no agent has ever paired. */
  agent: { id: string; status: string; lastSeenAt: string | null } | null;
  /** Derived: status is OFFLINE, or the agent has not been seen for 90 seconds (the offline sweep threshold). */
  offline: boolean;
  maintenanceStatus: string | null;
  currentJob: {
    id: string;
    orderId: string;
    publicOrderNumber: string;
    status: string;
  } | null;
  queue: { jobs: number; pages: number };
  pageLimit: {
    enabled: boolean;
    limit: number | null;
    period: string;
    periodStart: string;
    pagesUsed: number;
    /** null when enforcement is off or no limit is set. */
    remaining: number | null;
  };
  /** Jobs that ended FAILED / TIMEOUT / UNKNOWN in the last 24 hours on this printer. */
  errors: { failedJobs24h: number; lastFailureReason: string | null };
}

/** `GET /v1/shop/dashboard/printers?shopId` (VIEW_PRINTER_DASHBOARD). */
export interface PrinterDashboardResponse {
  shopId: string;
  generatedAt: string;
  total: number;
  items: DashboardPrinter[];
  /** Paper on hand by size (active stock lines; empty unless the shop keeps stock). */
  paper: {
    trackingEnabled: boolean;
    bySize: Array<{ paperSize: string; quantity: number; lowStockItems: number }>;
  };
}

/** `GET /v1/admin/dashboard` (ADMIN role only). Platform-wide. */
export interface AdminDashboardResponse {
  generatedAt: string;
  businesses: { total: number; byStatus: Record<string, number> };
  users: { total: number; byRole: Record<string, number>; byStatus: Record<string, number> };
  orders: { total: number; today: number; byStatus: Record<string, number> };
  printers: { total: number; byStatus: Record<string, number>; agentsActive: number };
  storage: { documents: number; readyBytes: number };
  system: {
    ready: boolean;
    checks: Array<{ name: string; ok: boolean; error?: string }>;
  };
  errors: { failedJobs24h: number; failedPayments24h: number };
  /** Counts of audit rows in the last 24 hours for security-relevant actions. */
  securityEvents24h: { total: number; byAction: Record<string, number> };
  /** The platform has no subscription/billing model yet; always `null`. */
  subscriptions: null;
  /** 27.6: today's revenue per business, same gross/net definitions as the shop-scoped
   * revenue report (ReportsService.revenue -- gross by payments' stable paidAt, net = gross
   * minus COMPLETED refunds), highest gross first, capped at 50 businesses. */
  revenueByShop: Array<{
    shopId: string;
    shopName: string;
    currency: string;
    grossTodayMinor: number;
    netTodayMinor: number;
  }>;
}
