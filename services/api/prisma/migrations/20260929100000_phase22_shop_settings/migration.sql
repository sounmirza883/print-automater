-- 22.1 (PRD 75/76): per-shop business + automation settings.
--
-- Decision: the four existing shop flags (auto_failover_enabled,
-- inventory_tracking_enabled, quality_check_enabled, multi_item_enabled) STAY on
-- "shops". Every hot-path read (allocation, the job/order machines, the worker
-- sweeps) is therefore byte-identical, and nothing needs a backfill or a
-- two-place write. They are exposed and edited through GET/PUT /v1/shop/settings.
-- "shop_settings" holds only what did not exist: currency, tax, operating hours,
-- notification settings and the new automation toggles.
--
-- Every shop always has exactly one row: it is backfilled below and a trigger on
-- "shops" creates it for every later shop, so readers never see "no row" and a
-- row lock (FOR SHARE) on it is a real barrier against a concurrent toggle write.
CREATE TABLE "shop_settings" (
  "shop_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'PKR',
  "tax_rate_basis_points" INTEGER,
  "operating_hours" JSONB,
  "notification_settings" JSONB NOT NULL DEFAULT '{"emailEnabled":true,"appEnabled":true}',
  "auto_printer_assignment_enabled" BOOLEAN NOT NULL DEFAULT true,
  "auto_operator_assignment_enabled" BOOLEAN NOT NULL DEFAULT false,
  "auto_queue_management_enabled" BOOLEAN NOT NULL DEFAULT true,
  "inventory_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
  "automatic_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
  "page_limit_enforcement_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("shop_id"),
  CONSTRAINT "shop_settings_currency_shape" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "shop_settings_tax_range" CHECK (
    "tax_rate_basis_points" IS NULL OR ("tax_rate_basis_points" >= 0 AND "tax_rate_basis_points" <= 10000)
  ),
  CONSTRAINT "shop_settings_version_nonneg" CHECK ("version" >= 0)
);

ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "shop_settings" ("shop_id") SELECT "id" FROM "shops" ON CONFLICT DO NOTHING;

CREATE FUNCTION "shops_create_settings"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "shop_settings" ("shop_id") VALUES (NEW."id") ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shops_create_settings_trg"
  AFTER INSERT ON "shops"
  FOR EACH ROW EXECUTE FUNCTION "shops_create_settings"();
