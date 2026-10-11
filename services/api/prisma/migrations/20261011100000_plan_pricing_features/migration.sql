-- Admin-managed pricing: annual price, "Most popular", contact-only (custom pricing),
-- display order, and the shared feature rows + per-plan values behind the public
-- Compare plans table. Creates no plans or features (seed-plans.ts does, on request).
ALTER TABLE "plan_definitions"
  ADD COLUMN "annual_price_minor" INTEGER,
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contact_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "plan_definitions_annual_price_non_negative"
    CHECK ("annual_price_minor" IS NULL OR "annual_price_minor" >= 0);

CREATE TABLE "plan_features" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "show_on_card" BOOLEAN NOT NULL DEFAULT false,
    "card_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plan_features_section_not_blank" CHECK (length(btrim("section")) > 0),
    CONSTRAINT "plan_features_label_not_blank" CHECK (length(btrim("label")) > 0)
);

CREATE UNIQUE INDEX "plan_features_section_label_key" ON "plan_features"("section", "label");

CREATE TABLE "plan_feature_values" (
    "plan_id" TEXT NOT NULL,
    "feature_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "plan_feature_values_pkey" PRIMARY KEY ("plan_id", "feature_id"),
    CONSTRAINT "plan_feature_values_value_not_blank" CHECK (length(btrim("value")) > 0)
);

CREATE INDEX "plan_feature_values_feature_id_idx" ON "plan_feature_values"("feature_id");

ALTER TABLE "plan_feature_values" ADD CONSTRAINT "plan_feature_values_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "plan_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_feature_values" ADD CONSTRAINT "plan_feature_values_feature_id_fkey"
  FOREIGN KEY ("feature_id") REFERENCES "plan_features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
