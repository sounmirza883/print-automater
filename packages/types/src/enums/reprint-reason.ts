/** §67 -- why a job is being reprinted. Hand-mirrors the Prisma `ReprintReason`
 * enum (enum-mirror.spec.ts fails on drift). The first seven match the failure
 * picker (JobFailureReason); CUSTOMER_REQUEST and OTHER cover reprints that are
 * not a production fault. */
export const ReprintReason = {
  PRINTER_ERROR: "PRINTER_ERROR",
  PAPER_JAM: "PAPER_JAM",
  WRONG_PAPER: "WRONG_PAPER",
  POOR_QUALITY: "POOR_QUALITY",
  FILE_PROBLEM: "FILE_PROBLEM",
  INK_TONER: "INK_TONER",
  HARDWARE: "HARDWARE",
  CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
  OTHER: "OTHER",
} as const;

export type ReprintReason = (typeof ReprintReason)[keyof typeof ReprintReason];
