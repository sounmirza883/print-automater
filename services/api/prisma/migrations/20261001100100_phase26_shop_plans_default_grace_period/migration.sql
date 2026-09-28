-- 26.1's own follow-up: a plan starting at NULL (never activated = expired) for
-- every shop, including every one an e2e fixture creates fresh, would make the
-- enforcement landing in 26.3 break every one of the 53 existing test files that
-- create a shop directly -- and, for real shops, would stop a business printing
-- the instant this feature ships, before any admin has had a chance to touch it.
--
-- Fix: a shop gets a real default grace period the moment it exists, instead of
-- requiring day-one admin activation. New shops (the trigger, going forward) get
-- 30 days -- ample for onboarding, and ample for any e2e test, which completes in
-- seconds. Shops that already existed before this feature shipped are
-- grandfathered further out (3650 days) so deploying this never silently stops
-- an existing business from printing. `expires_at` stays nullable and
-- ShopPlanService's own isActiveAt() still treats NULL as expired -- an admin
-- can still let a plan lapse to NULL if that's ever wanted -- only the DEFAULT
-- provisioning value changes here.
UPDATE "shop_plans" SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '3650 days'
  WHERE "expires_at" IS NULL;

CREATE OR REPLACE FUNCTION "shops_create_plan"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "shop_plans" ("shop_id", "expires_at")
    VALUES (NEW."id", CURRENT_TIMESTAMP + INTERVAL '30 days')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
