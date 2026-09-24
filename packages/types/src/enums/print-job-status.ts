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
  // 18.1 (§65's fuller lifecycle). Added to Prisma then but missing here
  // until the Phase 18 review. CLAIMED and PRINTED keep their names
  // rather than becoming the PRD's "Assigned"/"Completed": those strings
  // cross the agent wire (frozen in 15.6).
  CREATED: "CREATED",
  WAITING: "WAITING",
  PAUSED: "PAUSED",
  REASSIGNED: "REASSIGNED",
} as const;

export type PrintJobStatus = (typeof PrintJobStatus)[keyof typeof PrintJobStatus];
