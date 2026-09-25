import type {
  DashboardPrinter,
  OwnerDashboardResponse,
  PrinterDashboardResponse,
} from "@print-automated/types";
import type { Tone } from "@/lib/job-status";

/** View-model helpers for the dashboards: pure functions of the API's
 * documented response shapes, so the rules below (what counts as "needs
 * a person", how a range is built, which paper is running low) are unit
 * tested rather than buried in JSX. */

export type RangePreset = "today" | "7d" | "30d";

export const RANGE_PRESETS: ReadonlyArray<{ id: RangePreset; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO `from`/`to` for a preset. "Today" is since 00:00 UTC, the same
 * boundary the API uses for its own "today" figures, so a "Today" period
 * agrees with the today tiles. */
export function rangeFor(
  preset: RangePreset,
  now: number = Date.now(),
): { from: string; to: string } {
  const to = new Date(now);
  if (preset === "today") {
    const start = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    return { from: start.toISOString(), to: to.toISOString() };
  }
  const days = preset === "7d" ? 7 : 30;
  return { from: new Date(now - days * DAY_MS).toISOString(), to: to.toISOString() };
}

export interface AttentionItem {
  id: "blocked" | "failed" | "unresolved" | "orders";
  label: string;
  count: number;
  tone: Tone;
  explanation: string;
  /** Where the person goes to deal with it (the queue, filtered). */
  href: string;
}

/** The counts that mean "a human has to do something", most urgent
 * first. `unresolved` (UNKNOWN jobs) leads because paper may already
 * have come out: retrying blindly would print twice. Zero-count items are
 * kept (the panel shows an all-clear when every count is zero). */
export function attentionItems(owner: OwnerDashboardResponse): AttentionItem[] {
  const { attention } = owner;
  return [
    {
      id: "unresolved",
      label: "Unresolved prints",
      count: attention.unresolvedJobs,
      tone: "danger",
      explanation: "Paper may have come out. Check the tray and resolve; do not retry blindly.",
      href: "/orders?group=needsAttention",
    },
    {
      id: "failed",
      label: "Failed jobs",
      count: attention.failedJobs,
      tone: "danger",
      explanation: "Failed or timed out. Retry, reprint or reassign.",
      href: "/orders?group=needsAttention",
    },
    {
      id: "blocked",
      label: "Blocked jobs",
      count: attention.blockedJobs,
      tone: "caution",
      explanation: "Parked without a printer. The reason is shown on each job.",
      href: "/orders?group=needsAttention",
    },
    {
      id: "orders",
      label: "Orders needing attention",
      count: attention.ordersNeedingAttention,
      tone: "caution",
      explanation: "Orders with a stranded or blocked job.",
      href: "/orders?group=needsAttention",
    },
  ];
}

export function totalAttention(owner: OwnerDashboardResponse): number {
  const { attention } = owner;
  return (
    attention.blockedJobs +
    attention.failedJobs +
    attention.unresolvedJobs +
    attention.ordersNeedingAttention
  );
}

/** Rows of the revenue table. Money stays in `revenue.currency`. */
export function revenueRows(revenue: OwnerDashboardResponse["revenue"]): Array<{
  period: string;
  grossMinor: number;
  refundedMinor: number;
  netMinor: number;
}> {
  return [
    {
      period: "Today",
      grossMinor: revenue.grossTodayMinor,
      refundedMinor: revenue.refundedTodayMinor,
      netMinor: revenue.netTodayMinor,
    },
    {
      period: "Selected period",
      grossMinor: revenue.grossPeriodMinor,
      refundedMinor: revenue.refundedPeriodMinor,
      netMinor: revenue.netPeriodMinor,
    },
  ];
}

const GROUP_LABELS: Record<string, string> = {
  needsAttention: "Needs attention",
  printing: "Printing",
  ready: "Ready",
  completed: "Completed",
  failed: "Failed",
};

const GROUP_TONES: Record<string, Tone> = {
  needsAttention: "caution",
  printing: "accent",
  ready: "good",
  completed: "neutral",
  failed: "danger",
};

export function orderGroupRows(
  byGroup: OwnerDashboardResponse["orders"]["byGroup"],
): Array<{ label: string; value: number; tone: Tone; href: string }> {
  return Object.entries(byGroup).map(([group, value]) => ({
    label: GROUP_LABELS[group] ?? group,
    value,
    tone: GROUP_TONES[group] ?? "neutral",
    href: `/orders?group=${group}`,
  }));
}

/** Remaining page allowance as a fraction of the limit, or null when the
 * printer has no enforced limit. */
export function pageAllowanceFraction(printer: DashboardPrinter): number | null {
  const { enabled, limit, pagesUsed } = printer.pageLimit;
  if (!enabled || limit === null || limit <= 0) {
    return null;
  }
  return Math.min(1, pagesUsed / limit);
}

export type PageLimitStanding = "off" | "ok" | "low" | "reached";

export function pageLimitStanding(printer: DashboardPrinter): PageLimitStanding {
  const fraction = pageAllowanceFraction(printer);
  if (fraction === null) {
    return "off";
  }
  if (fraction >= 1) {
    return "reached";
  }
  return fraction >= 0.85 ? "low" : "ok";
}

/** Paper sizes with at least one low line, or nothing on hand at all. */
export function paperNeedingRestock(
  paper: PrinterDashboardResponse["paper"],
): Array<{ paperSize: string; quantity: number; lowStockItems: number }> {
  return paper.bySize.filter((row) => row.quantity <= 0 || row.lowStockItems > 0);
}

export interface PrinterSummary {
  online: number;
  offline: number;
  needsHelp: number;
}

/** Fleet-at-a-glance counts. "offline" uses the API's derived flag (status
 * OFFLINE, or agent silent past the sweep threshold), not the raw status. */
export function summarizePrinters(printers: readonly DashboardPrinter[]): PrinterSummary {
  let online = 0;
  let offline = 0;
  let needsHelp = 0;
  for (const printer of printers) {
    if (printer.offline) {
      offline += 1;
    } else if (printer.status === "ERROR" || printer.status === "MAINTENANCE") {
      needsHelp += 1;
    } else if (printer.status === "ONLINE" || printer.status === "BUSY") {
      online += 1;
    }
  }
  return { online, offline, needsHelp };
}
