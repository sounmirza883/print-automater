-- 15.3/§16: expand PrinterStatus additively. Postgres requires each new
-- enum value in its own ALTER TYPE statement; existing rows and every
-- persisted ONLINE/OFFLINE/ERROR/DISABLED string are untouched.
ALTER TYPE "PrinterStatus" ADD VALUE IF NOT EXISTS 'BUSY';
ALTER TYPE "PrinterStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "PrinterStatus" ADD VALUE IF NOT EXISTS 'MAINTENANCE';
ALTER TYPE "PrinterStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

-- 15.3: printer profile columns. All nullable, or defaulted for the
-- two array columns (Prisma disallows a nullable list field) -- every
-- printer row that exists today is unaffected.
ALTER TABLE "printers"
  ADD COLUMN "model" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "connection_type" TEXT,
  ADD COLUMN "supported_sizes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "supported_paper_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "max_job_pages" INTEGER,
  ADD COLUMN "maintenance_status" TEXT,
  ADD COLUMN "last_status_at" TIMESTAMP(3);
