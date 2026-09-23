-- 18.1/18.2: additive enum values for the job-lifecycle split. Split
-- into its own migration/transaction deliberately -- Postgres refuses
-- to let a newly-added enum value be referenced (e.g. in a DEFAULT
-- clause) inside the same transaction that added it, so the follow-up
-- migration that sets print_jobs.status's new DEFAULT 'CREATED' has to
-- run afterward, once this one has committed. Additive only, never a
-- rename/remove: CLAIMED/PRINTED already cross the agent wire (15.6
-- froze that contract).
ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "PrintJobStatus" ADD VALUE IF NOT EXISTS 'REASSIGNED';

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'QUALITY_CHECK';
