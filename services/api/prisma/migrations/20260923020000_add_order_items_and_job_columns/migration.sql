-- 15.4: order-item/job-lifecycle groundwork for Phase 18.

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('PRINT', 'LAMINATE', 'BIND');

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "print_configuration" JSONB NOT NULL,
    "quantity" INTEGER NOT NULL,
    "item_type" "OrderItemType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "pricing_snapshot" JSONB,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_document_id_idx" ON "order_items"("document_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: print_jobs gains the Phase 18 groundwork columns. All
-- nullable, or defaulted (attempt/priority), so every existing row
-- and writer is unaffected until this migration's own backfill below
-- and, later, Phase 18's code actually reads/writes them.
ALTER TABLE "print_jobs"
  ADD COLUMN "order_item_id" TEXT,
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "superseded_at" TIMESTAMP(3),
  ADD COLUMN "paused_at" TIMESTAMP(3),
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "print_jobs_order_item_id_idx" ON "print_jobs"("order_item_id");

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: orders gains qualityCheckStatus, default 'NOT_REQUIRED'
-- so every existing order is unaffected.
ALTER TABLE "orders" ADD COLUMN "quality_check_status" TEXT DEFAULT 'NOT_REQUIRED';

-- AlterTable: shops gain both automation-scope toggles, both default
-- false so no existing shop's behaviour changes.
ALTER TABLE "shops"
  ADD COLUMN "quality_check_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "multi_item_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (1/3): exactly one synthetic PRINT OrderItem per existing
-- order, built from that order's own document_id + print_configuration.
-- quantity comes from the "copies" key already inside that JSON blob
-- (falls back to 1 if it's ever missing/non-numeric, which no real
-- row is, but keeps this insert total rather than order-dependent).
INSERT INTO "order_items" (
    "id", "order_id", "document_id", "print_configuration", "quantity",
    "item_type", "required", "pricing_snapshot", "sequence",
    "created_at", "updated_at"
)
SELECT
    gen_random_uuid(),
    o."id",
    o."document_id",
    o."print_configuration",
    COALESCE((o."print_configuration" ->> 'copies')::INTEGER, 1),
    'PRINT',
    true,
    NULL,
    0,
    o."created_at",
    o."created_at"
FROM "orders" o;

-- Backfill (2/3): point every existing print_job at the synthetic item
-- its own order just got above. Each order has exactly one order_item
-- at this point in the migration, so this join is unambiguous.
UPDATE "print_jobs" pj
SET "order_item_id" = oi."id"
FROM "order_items" oi
WHERE oi."order_id" = pj."order_id";

-- Backfill (3/3): reproduce SHOP_ORDER_INCLUDE's current
-- `orderBy: createdAt desc, take: 1` as real data instead of a
-- query-time accident. For every order with more than one print_job
-- (retry history), every job except the newest gets superseded_at set
-- to its immediate successor's created_at; the newest job (no
-- successor) keeps superseded_at NULL. `id` is a deterministic
-- tie-break for the rare case of two jobs sharing one created_at.
WITH ordered_jobs AS (
    SELECT
        "id",
        LEAD("created_at") OVER (
            PARTITION BY "order_id" ORDER BY "created_at" ASC, "id" ASC
        ) AS "next_created_at"
    FROM "print_jobs"
)
UPDATE "print_jobs" pj
SET "superseded_at" = oj."next_created_at"
FROM ordered_jobs oj
WHERE pj."id" = oj."id" AND oj."next_created_at" IS NOT NULL;
