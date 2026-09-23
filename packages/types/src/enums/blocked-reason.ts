/** §79/18.6: why `allocatePrinter()` couldn't place a job anywhere.
 * Surfaced on `print_jobs.blockedReason` (a plain string column, like
 * `Printer.maintenanceStatus` -- no closed Postgres enum needed since
 * nothing in the schema itself branches on it, only application code
 * comparing against this fixed set of literal values). */
export const BlockedReason = {
  NO_COMPATIBLE_PRINTER: "NO_COMPATIBLE_PRINTER",
  PRINTER_OFFLINE: "PRINTER_OFFLINE",
  PRINTER_DISABLED: "PRINTER_DISABLED",
  PAGE_LIMIT_REACHED: "PAGE_LIMIT_REACHED",
  NO_PAPER: "NO_PAPER",
  OPERATOR_UNAVAILABLE: "OPERATOR_UNAVAILABLE",
  MANUAL_APPROVAL_REQUIRED: "MANUAL_APPROVAL_REQUIRED",
} as const;

export type BlockedReason = (typeof BlockedReason)[keyof typeof BlockedReason];
