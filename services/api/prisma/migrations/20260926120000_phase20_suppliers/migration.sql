-- 20.6 (PRD 29/30): suppliers and the many-to-many supplier_products link to
-- inventory items. Tenant isolation is enforced by the database too: the link's
-- (supplier_id, shop_id) and (inventory_item_id, shop_id) are COMPOSITE foreign
-- keys, so a supplier of shop A can never be linked to an item of shop B.
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contact_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "payment_terms" TEXT,
  "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "suppliers_id_shop_id_key" ON "suppliers"("id", "shop_id");
CREATE INDEX "suppliers_shop_id_idx" ON "suppliers"("shop_id");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Target of the composite FK below.
CREATE UNIQUE INDEX "inventory_items_id_shop_id_key" ON "inventory_items"("id", "shop_id");

CREATE TABLE "supplier_products" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "supplier_sku" TEXT,
  "unit_price_minor" INTEGER,
  "lead_time_days" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_products_price_non_negative" CHECK ("unit_price_minor" IS NULL OR "unit_price_minor" >= 0),
  CONSTRAINT "supplier_products_lead_time_non_negative" CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0)
);
CREATE UNIQUE INDEX "supplier_products_supplier_id_inventory_item_id_key"
  ON "supplier_products"("supplier_id", "inventory_item_id");
CREATE INDEX "supplier_products_shop_id_idx" ON "supplier_products"("shop_id");
CREATE INDEX "supplier_products_inventory_item_id_idx" ON "supplier_products"("inventory_item_id");
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_shop_fkey"
  FOREIGN KEY ("supplier_id", "shop_id") REFERENCES "suppliers"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_item_shop_fkey"
  FOREIGN KEY ("inventory_item_id", "shop_id") REFERENCES "inventory_items"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
