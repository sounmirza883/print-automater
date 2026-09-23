-- 15.5: shop-scoped walk-in customer records (§33), plus the
-- coexisting orders.customer_record_id (nullable -- every existing
-- order and every self-service order has none) that Phase 17's
-- counter-ordering flow will start writing. This migration only adds
-- the column/table; no existing writer is touched.

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_shop_id_idx" ON "customers"("shop_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: orders gains the nullable customer_record_id FK.
ALTER TABLE "orders" ADD COLUMN "customer_record_id" TEXT;

-- CreateIndex
CREATE INDEX "orders_customer_record_id_idx" ON "orders"("customer_record_id");

-- AddForeignKey: SetNull, not Cascade -- deleting a shop's walk-in
-- customer record (17.4's job) must never take an order's own history
-- down with it, the same "the order survives" reasoning
-- print_jobs.order_item_id's own SET NULL already established in 15.4.
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_record_id_fkey" FOREIGN KEY ("customer_record_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
