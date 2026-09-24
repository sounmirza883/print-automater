-- 20.1 (§26/§27): inventory items and the append-only movement ledger.
-- Additive only; no existing table is touched (the tracking flag lands in 20.3).

CREATE TYPE "InventoryMovementType" AS ENUM
  ('PURCHASE', 'ADJUSTMENT', 'CONSUMPTION', 'RETURN', 'TRANSFER', 'CORRECTION');

CREATE TABLE "inventory_items" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "paper_size" TEXT,
  "paper_type" TEXT,
  "weight_gsm" INTEGER,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "min_quantity" INTEGER NOT NULL DEFAULT 0,
  "max_quantity" INTEGER,
  "location" TEXT,
  "unit_cost_minor" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  -- Last line of defence for PRD 100: stock can never go below zero, whatever
  -- the application does.
  CONSTRAINT "inventory_items_quantity_non_negative" CHECK ("quantity" >= 0),
  CONSTRAINT "inventory_items_min_quantity_non_negative" CHECK ("min_quantity" >= 0),
  CONSTRAINT "inventory_items_max_gte_min" CHECK ("max_quantity" IS NULL OR "max_quantity" >= "min_quantity"),
  CONSTRAINT "inventory_items_weight_positive" CHECK ("weight_gsm" IS NULL OR "weight_gsm" > 0),
  CONSTRAINT "inventory_items_unit_cost_non_negative" CHECK ("unit_cost_minor" IS NULL OR "unit_cost_minor" >= 0)
);

CREATE UNIQUE INDEX "inventory_items_shop_id_sku_key" ON "inventory_items"("shop_id", "sku");
CREATE INDEX "inventory_items_shop_id_idx" ON "inventory_items"("shop_id");
CREATE INDEX "inventory_items_shop_id_paper_size_idx" ON "inventory_items"("shop_id", "paper_size");

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_movements" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "inventory_item_id" TEXT NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "quantity_delta" INTEGER NOT NULL,
  "quantity_after" INTEGER NOT NULL,
  "reason" TEXT,
  "actor_id" TEXT,
  "print_job_id" TEXT,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_delta_non_zero" CHECK ("quantity_delta" <> 0),
  CONSTRAINT "inventory_movements_after_non_negative" CHECK ("quantity_after" >= 0)
);

CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key" ON "inventory_movements"("idempotency_key");
CREATE INDEX "inventory_movements_inventory_item_id_created_at_idx" ON "inventory_movements"("inventory_item_id", "created_at");
CREATE INDEX "inventory_movements_shop_id_created_at_idx" ON "inventory_movements"("shop_id", "created_at");
CREATE INDEX "inventory_movements_print_job_id_idx" ON "inventory_movements"("print_job_id");

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only ledger. The single permitted UPDATE is the FK's own
-- ON DELETE SET NULL of actor_id (removing a user account must not fail).
CREATE FUNCTION "inventory_movements_append_only"() RETURNS trigger AS $$
BEGIN
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NEW.id = OLD.id AND NEW.shop_id = OLD.shop_id
     AND NEW.inventory_item_id = OLD.inventory_item_id AND NEW.type = OLD.type
     AND NEW.quantity_delta = OLD.quantity_delta AND NEW.quantity_after = OLD.quantity_after
     AND NEW.reason IS NOT DISTINCT FROM OLD.reason
     AND NEW.print_job_id IS NOT DISTINCT FROM OLD.print_job_id
     AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'inventory_movements is append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory_movements_append_only"();
