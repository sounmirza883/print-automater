-- 20.7 (PRD 31): purchase orders. Receiving goods writes inventory movements in
-- one transaction (see the API); these tables only carry the document.
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "PurchaseOrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

CREATE SEQUENCE "purchase_order_number_seq";

CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "po_number" TEXT NOT NULL DEFAULT ('PO-' || lpad(nextval('purchase_order_number_seq')::text, 6, '0')),
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "payment_status" "PurchaseOrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  "expected_delivery_at" TIMESTAMP(3),
  "actual_delivery_at" TIMESTAMP(3),
  "total_cost_minor" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "created_by" TEXT,
  "received_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_total_non_negative" CHECK ("total_cost_minor" >= 0)
);
CREATE UNIQUE INDEX "purchase_orders_id_shop_id_key" ON "purchase_orders"("id", "shop_id");
CREATE UNIQUE INDEX "purchase_orders_shop_id_po_number_key" ON "purchase_orders"("shop_id", "po_number");
CREATE INDEX "purchase_orders_shop_id_status_created_at_idx" ON "purchase_orders"("shop_id", "status", "created_at");
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_shop_fkey"
  FOREIGN KEY ("supplier_id", "shop_id") REFERENCES "suppliers"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_received_by_fkey"
  FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "purchase_order_lines" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "quantity_ordered" INTEGER NOT NULL,
  "unit_cost_minor" INTEGER NOT NULL DEFAULT 0,
  "quantity_received" INTEGER,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_ordered_positive" CHECK ("quantity_ordered" > 0),
  CONSTRAINT "purchase_order_lines_cost_non_negative" CHECK ("unit_cost_minor" >= 0),
  CONSTRAINT "purchase_order_lines_received_non_negative" CHECK ("quantity_received" IS NULL OR "quantity_received" >= 0)
);
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_inventory_item_id_key"
  ON "purchase_order_lines"("purchase_order_id", "inventory_item_id");
CREATE INDEX "purchase_order_lines_shop_id_idx" ON "purchase_order_lines"("shop_id");
CREATE INDEX "purchase_order_lines_inventory_item_id_idx" ON "purchase_order_lines"("inventory_item_id");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_shop_fkey"
  FOREIGN KEY ("purchase_order_id", "shop_id") REFERENCES "purchase_orders"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_shop_fkey"
  FOREIGN KEY ("inventory_item_id", "shop_id") REFERENCES "inventory_items"("id", "shop_id") ON DELETE RESTRICT ON UPDATE CASCADE;
