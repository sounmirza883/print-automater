-- 19.1: per-printer page limits. Enforcement is opt-in (default false) so
-- no existing printer changes behaviour (PRD 23).
CREATE TYPE "PageLimitPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

ALTER TABLE "printers"
  ADD COLUMN "page_limit" INTEGER,
  ADD COLUMN "page_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "page_limit_period" "PageLimitPeriod" NOT NULL DEFAULT 'DAILY',
  ADD CONSTRAINT "printers_page_limit_positive" CHECK ("page_limit" IS NULL OR "page_limit" > 0);

CREATE TABLE "printer_page_usage" (
  "id" TEXT NOT NULL,
  "printer_id" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "pages_used" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printer_page_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "printer_page_usage_printer_id_period_start_key"
  ON "printer_page_usage"("printer_id", "period_start");

ALTER TABLE "printer_page_usage"
  ADD CONSTRAINT "printer_page_usage_printer_id_fkey"
  FOREIGN KEY ("printer_id") REFERENCES "printers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 19.4: opt-in automatic handoff (folds into shop_settings in 22.1).
ALTER TABLE "shops" ADD COLUMN "auto_failover_enabled" BOOLEAN NOT NULL DEFAULT false;
