-- 21.2 (PRD 66): the operator's failure-reason picker. A closed enum (like
-- ShopRejectionReason, not free text) plus an optional note, recorded on the
-- failed job itself. Nullable: agent-reported failures and timeouts carry no
-- reason until an operator picks one, and every existing row stays NULL.
CREATE TYPE "JobFailureReason" AS ENUM (
  'PRINTER_ERROR',
  'PAPER_JAM',
  'WRONG_PAPER',
  'POOR_QUALITY',
  'FILE_PROBLEM',
  'INK_TONER',
  'HARDWARE'
);

ALTER TABLE "print_jobs"
  ADD COLUMN "failure_reason" "JobFailureReason",
  ADD COLUMN "failure_note" TEXT;
