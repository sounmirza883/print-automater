-- 18.1/18.6/18.9: job-lifecycle split and allocation engine groundwork
-- (columns/constraints). Must run after 20260923080000's enum values
-- have committed -- this migration's own DEFAULT 'CREATED' clause
-- below references one of them.

-- 18.6: a job that allocatePrinter() couldn't place anywhere (WAITING,
-- blockedReason explains why) has no printer yet -- every job that DOES
-- have one is completely unaffected.
ALTER TABLE "print_jobs" ALTER COLUMN "printer_id" DROP NOT NULL;

-- 18.1: a freshly-exploded job starts unallocated (CREATED); dispatch
-- (18.5) is what moves it on to QUEUED or WAITING. Existing rows are
-- all already QUEUED-or-later and are untouched by a DEFAULT change.
ALTER TABLE "print_jobs" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- 18.9: manual/automatic operator assignment. Nullable, SetNull on
-- delete -- removing a staff account must never take job history down
-- with it, the same reasoning orderItem/printer relations already use.
ALTER TABLE "print_jobs" ADD COLUMN "operator_id" TEXT;

CREATE INDEX "print_jobs_operator_id_idx" ON "print_jobs"("operator_id");

ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
