/** §66 -- why a print job failed, chosen from a picker by the operator (not free
 * text; an optional note sits beside it). Hand-mirrors the Prisma
 * `JobFailureReason` enum (enum-mirror.spec.ts fails on drift), following the
 * ShopRejectionReason precedent. */
export const JobFailureReason = {
  PRINTER_ERROR: "PRINTER_ERROR",
  PAPER_JAM: "PAPER_JAM",
  WRONG_PAPER: "WRONG_PAPER",
  POOR_QUALITY: "POOR_QUALITY",
  FILE_PROBLEM: "FILE_PROBLEM",
  INK_TONER: "INK_TONER",
  HARDWARE: "HARDWARE",
} as const;

export type JobFailureReason = (typeof JobFailureReason)[keyof typeof JobFailureReason];
