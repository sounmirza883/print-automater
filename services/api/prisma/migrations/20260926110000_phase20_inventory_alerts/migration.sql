-- 20.5 (PRD 32): low-stock alerts. The alert row IS the staff-facing in-app
-- notification (the existing notifications table is customer/order scoped).
-- inventory_items.low_stock_alerted_at is the dedupe latch: set when an alert is
-- raised, cleared when stock recovers, so a sustained low level raises ONE alert.
CREATE TYPE "InventoryAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

ALTER TABLE "inventory_items" ADD COLUMN "low_stock_alerted_at" TIMESTAMP(3);

CREATE TABLE "inventory_alerts" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "status" "InventoryAlertStatus" NOT NULL DEFAULT 'OPEN',
  "quantity_at_alert" INTEGER NOT NULL,
  "min_quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_alerts_shop_id_status_created_at_idx" ON "inventory_alerts"("shop_id", "status", "created_at");
CREATE INDEX "inventory_alerts_inventory_item_id_status_idx" ON "inventory_alerts"("inventory_item_id", "status");

ALTER TABLE "inventory_alerts"
  ADD CONSTRAINT "inventory_alerts_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_alerts"
  ADD CONSTRAINT "inventory_alerts_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
