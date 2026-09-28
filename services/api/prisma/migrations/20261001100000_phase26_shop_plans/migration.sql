-- 26.1: one row per shop, mirroring shop_settings's own pattern (backfill + a
-- trigger on "shops" so every shop, including every later one, always has
-- exactly one row -- readers never see "no row", and a row lock (FOR SHARE) is
-- a real barrier against a concurrent activate/renew write).
--
-- expires_at NULL means "never activated"; both application code and every
-- enforcement check treat that identically to "expired". There is no separate
-- stored status column: activate/renew only ever moves expires_at forward, and
-- "is this plan active" is always expires_at > now(), never trusted as a cached
-- boolean that could drift from the date itself.
CREATE TABLE "shop_plans" (
  "shop_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "activated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_plans_pkey" PRIMARY KEY ("shop_id")
);

ALTER TABLE "shop_plans" ADD CONSTRAINT "shop_plans_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "shop_plans" ("shop_id") SELECT "id" FROM "shops" ON CONFLICT DO NOTHING;

CREATE FUNCTION "shops_create_plan"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "shop_plans" ("shop_id") VALUES (NEW."id") ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shops_create_plan_trg"
  AFTER INSERT ON "shops"
  FOR EACH ROW EXECUTE FUNCTION "shops_create_plan"();
