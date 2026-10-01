-- Plan management: named, priced plan tiers an admin defines once and assigns to
-- any number of businesses -- replacing "activate = add a raw number of days".
-- A business's activation/renewal length now comes from its plan's own
-- billing_period_days, never from a client-supplied number.
--
-- shop_plans.plan_definition_id is NULLABLE: every existing business (only ever
-- activated the old way, or never activated at all) has no plan definition, and
-- reads as `plan: null` -- nothing is backfilled or invented here. Production
-- plan names/prices are a business decision, so this migration creates none.
--
-- The FK is ON DELETE RESTRICT (not SET NULL): PlanDefinitionService already
-- refuses deleting a plan any business is assigned to (409
-- PLAN_DEFINITION_IN_USE); RESTRICT makes the database refuse it as well, so a
-- delete racing a concurrent assign can never silently strip that business's
-- assignment.
CREATE TABLE "plan_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "billing_period_days" INTEGER NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_definitions_pkey" PRIMARY KEY ("id"),
    -- Database-level backstops for createPlanDefinitionSchema's own rules (the
    -- schema's upper bounds stay application policy, not constraints).
    CONSTRAINT "plan_definitions_name_not_blank" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "plan_definitions_price_minor_non_negative" CHECK ("price_minor" >= 0),
    CONSTRAINT "plan_definitions_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "plan_definitions_billing_period_days_positive" CHECK ("billing_period_days" >= 1)
);

CREATE UNIQUE INDEX "plan_definitions_name_key" ON "plan_definitions"("name");

ALTER TABLE "shop_plans" ADD COLUMN "plan_definition_id" TEXT;

-- subscriberCount (a per-plan count of shop_plans rows) and the RESTRICT check
-- on delete both look rows up by this column.
CREATE INDEX "shop_plans_plan_definition_id_idx" ON "shop_plans"("plan_definition_id");

ALTER TABLE "shop_plans" ADD CONSTRAINT "shop_plans_plan_definition_id_fkey"
  FOREIGN KEY ("plan_definition_id") REFERENCES "plan_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
