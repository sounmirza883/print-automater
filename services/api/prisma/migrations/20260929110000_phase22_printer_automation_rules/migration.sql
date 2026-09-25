-- 22.3 (PRD 77): ordered per-shop printer automation rules, as data. They only
-- ever choose AMONG printers that already passed allocation's hard filters, so an
-- empty table (every shop today) changes nothing. printer_ids has no foreign key on
-- purpose: a removed printer simply stops matching.
CREATE TYPE "PrinterRuleAction" AS ENUM ('PREFER', 'AVOID');

CREATE TABLE "printer_automation_rules" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "action" "PrinterRuleAction" NOT NULL,
  "printer_ids" TEXT[] NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printer_automation_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "printer_automation_rules_position_nonneg" CHECK ("position" >= 0),
  CONSTRAINT "printer_automation_rules_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "printer_automation_rules_printers_range" CHECK (
    cardinality("printer_ids") >= 1 AND cardinality("printer_ids") <= 50
  ),
  CONSTRAINT "printer_automation_rules_conditions_object" CHECK (jsonb_typeof("conditions") = 'object')
);

CREATE INDEX "printer_automation_rules_shop_id_position_idx"
  ON "printer_automation_rules"("shop_id", "position");

ALTER TABLE "printer_automation_rules" ADD CONSTRAINT "printer_automation_rules_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
