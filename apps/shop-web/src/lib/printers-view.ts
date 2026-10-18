import type { PrinterResponse } from "@print-automated/api-client";
import type { DashboardPrinter } from "@print-automated/types";

/** A printer as the management screens show it: its profile (from the
 * printer list, which every shop role but operators may read) plus, when
 * the role may see the printer dashboard, live queue/agent/error data. */
export interface PrinterRow {
  printer: PrinterResponse;
  live: DashboardPrinter | null;
}

export function mergePrinters(
  printers: readonly PrinterResponse[],
  live: readonly DashboardPrinter[] | null,
): PrinterRow[] {
  const byId = new Map((live ?? []).map((entry) => [entry.id, entry]));
  return printers.map((printer) => ({ printer, live: byId.get(printer.id) ?? null }));
}

/** The status to SHOW: the derived "offline" (agent silent) wins over the
 * stored status when live data says so. */
export function effectiveStatus(row: PrinterRow): { label: string; offline: boolean } {
  if (row.live?.offline === true) {
    return { label: "OFFLINE", offline: true };
  }
  return { label: row.printer.status, offline: row.printer.status === "OFFLINE" };
}

export function supportedCapabilities(capabilities: PrinterResponse["capabilities"]): string[] {
  if (capabilities === null) {
    return [];
  }
  const labels: string[] = [];
  if (capabilities.color) labels.push("Colour");
  if (capabilities.duplex) labels.push("Double-sided");
  if (capabilities.a4) labels.push("A4");
  if (capabilities.a3) labels.push("A3");
  return labels;
}

export type UsageStanding = "off" | "ok" | "low" | "reached";

/** Pages used against the limit. Off unless enforcement is ON and a limit is set. */
export function usageStanding(printer: PrinterResponse): {
  standing: UsageStanding;
  fraction: number | null;
} {
  if (!printer.pageLimitEnabled || printer.pageLimit === null || printer.pageLimit <= 0) {
    return { standing: "off", fraction: null };
  }
  const fraction = Math.min(1, printer.pagesUsedInPeriod / printer.pageLimit);
  const standing = fraction >= 1 ? "reached" : fraction >= 0.85 ? "low" : "ok";
  return { standing, fraction };
}

/** The page-limit field: blank clears the limit (null), otherwise a
 * whole number 1..10,000,000 (the API's own bounds); anything else is
 * `undefined` = invalid. */
export function parsePageLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  if (!/^\d{1,8}$/.test(trimmed)) {
    return undefined;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= 10_000_000 ? value : undefined;
}

interface BranchChoice {
  id: string;
  name: string;
  archivedAt: string | null;
}

/** The branches a computer can be paired to: every active branch, or only the person's own when
 * they are bound to one (the API refuses another). Never "All branches": a computer sits at one
 * place, unlike a person. Nothing is chosen for the person when there is more than one. */
export function pairingBranchOptions(
  actor: { branchId: string | null },
  branches: readonly BranchChoice[],
): Array<{ value: string; label: string }> {
  return branches
    .filter((branch) => branch.archivedAt === null)
    .filter((branch) => actor.branchId === null || branch.id === actor.branchId)
    .map((branch) => ({ value: branch.id, label: branch.name }));
}

/** Where a computer and its printers can be moved: the other active branches. */
export function moveBranchOptions(
  currentBranchId: string | undefined,
  branches: readonly BranchChoice[],
): Array<{ value: string; label: string }> {
  return branches
    .filter((branch) => branch.archivedAt === null && branch.id !== currentBranchId)
    .map((branch) => ({ value: branch.id, label: branch.name }));
}

/** How many OTHER printers share this printer's computer (they move with it). Null when that is
 * not known: live data only exists for roles that may read the printer dashboard, and a printer
 * with no paired agent has no computer to share. */
export function printersOnSameComputer(
  rows: readonly PrinterRow[],
  row: PrinterRow,
): number | null {
  const agentId = row.live?.agent?.id;
  if (agentId === undefined) {
    return null;
  }
  return rows.filter(
    (other) => other.printer.id !== row.printer.id && other.live?.agent?.id === agentId,
  ).length;
}

export const PERIOD_LABELS = {
  DAILY: "day",
  WEEKLY: "week (from Monday, UTC)",
  MONTHLY: "month (UTC)",
} as const;

export function periodWord(period: string): string {
  return period === "WEEKLY" ? "week" : period === "MONTHLY" ? "month" : "day";
}
