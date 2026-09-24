-- 20.3 (PRD 28): inventory tracking is opt-in per shop, default false, so no
-- existing shop's allocation changes the moment this column exists. Folds into
-- shop_settings in 22.1.
ALTER TABLE "shops" ADD COLUMN "inventory_tracking_enabled" BOOLEAN NOT NULL DEFAULT false;
