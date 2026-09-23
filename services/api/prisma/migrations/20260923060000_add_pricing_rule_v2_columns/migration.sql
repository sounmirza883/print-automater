-- 17.2/17.3/§14: pricing engine v2's new, nullable PricingRule columns.
-- Every existing row (including every seed.ts row) gets NULL for all
-- four -- computeQuote() already treats that as "no surcharge/no tax
-- configured," identical to its own pre-17.2 behaviour.

-- AlterTable
ALTER TABLE "pricing_rules"
  ADD COLUMN "paper_size_surcharge_per_page_minor" JSONB,
  ADD COLUMN "paper_type_surcharge_per_page_minor" JSONB,
  ADD COLUMN "finishing_charge_minor" JSONB,
  ADD COLUMN "tax_rate_basis_points" INTEGER;
