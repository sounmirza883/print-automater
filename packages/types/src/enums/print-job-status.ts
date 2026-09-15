/** print_jobs lifecycle (§45). QUEUED->CLAIMED is the atomic single-winner
 * claim (9.7); UNKNOWN is the deliberate non-retry state after a submission
 * of uncertain outcome (§47, 9.10) — never auto-resolved. */
export const PrintJobStatus = {
  QUEUED: "QUEUED",
  CLAIMED: "CLAIMED",
  PRINTING: "PRINTING",
  PRINTED: "PRINTED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
} as const;

export type PrintJobStatus = (typeof PrintJobStatus)[keyof typeof PrintJobStatus];
