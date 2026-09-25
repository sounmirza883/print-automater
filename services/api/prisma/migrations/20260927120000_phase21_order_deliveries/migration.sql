-- 21.5 (PRD 71): the optional delivery workflow. One delivery record per order
-- (UNIQUE order_id), created only when a shop chooses to deliver. It carries the
-- address, status, courier, tracking number and fee. The fee is recorded, not
-- charged: it never changes the order's pricing snapshot. The record is deleted
-- with its order (the address is personal data).
CREATE TYPE "DeliveryStatus" AS ENUM (
  'PENDING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "order_deliveries" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "address" TEXT NOT NULL,
  "courier" TEXT,
  "tracking_number" TEXT,
  "fee_minor" INTEGER NOT NULL DEFAULT 0,
  "dispatched_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_deliveries_fee_range" CHECK ("fee_minor" >= 0 AND "fee_minor" <= 1000000000),
  CONSTRAINT "order_deliveries_address_not_blank" CHECK (length(btrim("address")) > 0),
  CONSTRAINT "order_deliveries_delivered_has_time" CHECK ("status" <> 'DELIVERED' OR "delivered_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "order_deliveries_order_id_key" ON "order_deliveries"("order_id");
CREATE INDEX "order_deliveries_shop_id_status_idx" ON "order_deliveries"("shop_id", "status");

ALTER TABLE "order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
