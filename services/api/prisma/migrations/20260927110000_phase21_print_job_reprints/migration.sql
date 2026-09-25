-- 21.4 (PRD 67): reprints. A reprint is a NEW print job (created through the
-- normal allocation path) that references the original; this table is the link
-- and carries the reason, the requesting user, the time and any additional cost.
-- The original job is never mutated.
--
-- Double-trigger is impossible at the DATABASE level too: original_job_id is
-- UNIQUE, so a job can be reprinted at most once (a reprint can itself be
-- reprinted, forming a chain) even if two requests race past the application
-- guard. A duplicate insert fails and rolls back the whole request, including
-- the new job it had just created.
CREATE TYPE "ReprintReason" AS ENUM (
  'PRINTER_ERROR',
  'PAPER_JAM',
  'WRONG_PAPER',
  'POOR_QUALITY',
  'FILE_PROBLEM',
  'INK_TONER',
  'HARDWARE',
  'CUSTOMER_REQUEST',
  'OTHER'
);

CREATE TABLE "print_job_reprints" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "original_job_id" TEXT NOT NULL,
  "reprint_job_id" TEXT NOT NULL,
  "reason" "ReprintReason" NOT NULL,
  "note" TEXT,
  "requested_by" TEXT,
  "additional_cost_minor" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'STAFF',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_job_reprints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_job_reprints_cost_range" CHECK ("additional_cost_minor" >= 0 AND "additional_cost_minor" <= 1000000000),
  CONSTRAINT "print_job_reprints_distinct_jobs" CHECK ("original_job_id" <> "reprint_job_id")
);

CREATE UNIQUE INDEX "print_job_reprints_original_job_id_key" ON "print_job_reprints"("original_job_id");
CREATE UNIQUE INDEX "print_job_reprints_reprint_job_id_key" ON "print_job_reprints"("reprint_job_id");
CREATE INDEX "print_job_reprints_shop_id_created_at_idx" ON "print_job_reprints"("shop_id", "created_at");
CREATE INDEX "print_job_reprints_order_id_idx" ON "print_job_reprints"("order_id");

ALTER TABLE "print_job_reprints" ADD CONSTRAINT "print_job_reprints_original_job_id_fkey"
  FOREIGN KEY ("original_job_id") REFERENCES "print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_job_reprints" ADD CONSTRAINT "print_job_reprints_reprint_job_id_fkey"
  FOREIGN KEY ("reprint_job_id") REFERENCES "print_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_job_reprints" ADD CONSTRAINT "print_job_reprints_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
