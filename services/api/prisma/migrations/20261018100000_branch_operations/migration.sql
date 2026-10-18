-- Branch-scoped operations (step 3): orders, print jobs, printers, paired PCs and pairing codes
-- belong to a branch. Alerts get an optional branch (NULL = business-wide, which is what every
-- existing alert means).
--
-- Additive and safe next to older code on the shared dev database:
--   * every existing row is backfilled into its business's oldest non-archived branch (every
--     business has exactly one today), and only then does the column become NOT NULL;
--   * a BEFORE INSERT trigger fills a NULL branch_id, so a copy of the API that does not know
--     about branches keeps inserting. It is a safety net, not a code path: code that knows about
--     branches always sets branch_id itself (the e2e suite proves it by creating everything at a
--     second branch and asserting nothing lands in the first);
--   * the composite foreign key (branch_id, shop_id) -> branches(id, shop_id) makes it
--     impossible for a row to point at another business's branch.
-- The whole file is one implicit transaction: concurrent inserts wait on the table locks and then
-- find the triggers in place.

-- 1. Columns (nullable until backfilled).
ALTER TABLE "orders" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "print_jobs" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "printers" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "printer_agents" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "agent_pairing_codes" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "staff_notifications" ADD COLUMN "branch_id" TEXT;

-- 2. Backfill: the business's oldest non-archived branch (an archived one only if nothing else
-- exists). Print jobs follow their order.
UPDATE "orders" t SET "branch_id" = (
  SELECT b."id" FROM "branches" b WHERE b."shop_id" = t."shop_id"
  ORDER BY (b."archived_at" IS NOT NULL), b."created_at", b."id" LIMIT 1
);
UPDATE "printers" t SET "branch_id" = (
  SELECT b."id" FROM "branches" b WHERE b."shop_id" = t."shop_id"
  ORDER BY (b."archived_at" IS NOT NULL), b."created_at", b."id" LIMIT 1
);
UPDATE "printer_agents" t SET "branch_id" = (
  SELECT b."id" FROM "branches" b WHERE b."shop_id" = t."shop_id"
  ORDER BY (b."archived_at" IS NOT NULL), b."created_at", b."id" LIMIT 1
);
UPDATE "agent_pairing_codes" t SET "branch_id" = (
  SELECT b."id" FROM "branches" b WHERE b."shop_id" = t."shop_id"
  ORDER BY (b."archived_at" IS NOT NULL), b."created_at", b."id" LIMIT 1
);
UPDATE "print_jobs" j SET "branch_id" = o."branch_id"
FROM "orders" o WHERE o."id" = j."order_id";

-- 3. Required from now on.
ALTER TABLE "orders" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "print_jobs" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "printers" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "printer_agents" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "agent_pairing_codes" ALTER COLUMN "branch_id" SET NOT NULL;

-- 4. A branch can only be one of the row's own business's branches (MATCH SIMPLE: the nullable
-- alert column skips the check when it is NULL). NO ACTION: history is never deleted with a branch.
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "printers" ADD CONSTRAINT "printers_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "printer_agents" ADD CONSTRAINT "printer_agents_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "agent_pairing_codes" ADD CONSTRAINT "agent_pairing_codes_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 5. Indexes for the lists a branch filter narrows (also serve the foreign-key checks).
CREATE INDEX "orders_shop_id_branch_id_order_status_idx"
  ON "orders"("shop_id", "branch_id", "order_status");
CREATE INDEX "orders_shop_id_branch_id_created_at_idx"
  ON "orders"("shop_id", "branch_id", "created_at");
CREATE INDEX "print_jobs_shop_id_branch_id_status_idx"
  ON "print_jobs"("shop_id", "branch_id", "status");
CREATE INDEX "printers_shop_id_branch_id_idx" ON "printers"("shop_id", "branch_id");
CREATE INDEX "printer_agents_shop_id_branch_id_idx" ON "printer_agents"("shop_id", "branch_id");
CREATE INDEX "agent_pairing_codes_shop_id_branch_id_idx"
  ON "agent_pairing_codes"("shop_id", "branch_id");
CREATE INDEX "staff_notifications_shop_id_branch_id_idx"
  ON "staff_notifications"("shop_id", "branch_id");

-- 6. Safety net for code that does not know about branches: fill a NULL branch_id.
-- Orders, agents and pairing codes get the business's oldest non-archived branch.
CREATE FUNCTION "fill_default_branch"() RETURNS trigger AS $$
BEGIN
  IF NEW."branch_id" IS NULL THEN
    SELECT b."id" INTO NEW."branch_id"
    FROM "branches" b
    WHERE b."shop_id" = NEW."shop_id" AND b."archived_at" IS NULL
    ORDER BY b."created_at", b."id"
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "orders_fill_branch_trg"
  BEFORE INSERT ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "fill_default_branch"();
CREATE TRIGGER "printer_agents_fill_branch_trg"
  BEFORE INSERT ON "printer_agents"
  FOR EACH ROW EXECUTE FUNCTION "fill_default_branch"();
CREATE TRIGGER "agent_pairing_codes_fill_branch_trg"
  BEFORE INSERT ON "agent_pairing_codes"
  FOR EACH ROW EXECUTE FUNCTION "fill_default_branch"();

-- A printer that already belongs to a PC lives where that PC lives; otherwise the default.
CREATE FUNCTION "printers_fill_branch"() RETURNS trigger AS $$
BEGIN
  IF NEW."branch_id" IS NULL AND NEW."agent_id" IS NOT NULL THEN
    SELECT a."branch_id" INTO NEW."branch_id" FROM "printer_agents" a WHERE a."id" = NEW."agent_id";
  END IF;
  IF NEW."branch_id" IS NULL THEN
    SELECT b."id" INTO NEW."branch_id"
    FROM "branches" b
    WHERE b."shop_id" = NEW."shop_id" AND b."archived_at" IS NULL
    ORDER BY b."created_at", b."id"
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "printers_fill_branch_trg"
  BEFORE INSERT ON "printers"
  FOR EACH ROW EXECUTE FUNCTION "printers_fill_branch"();

-- A print job belongs to its order's branch.
CREATE FUNCTION "print_jobs_fill_branch"() RETURNS trigger AS $$
BEGIN
  IF NEW."branch_id" IS NULL THEN
    SELECT o."branch_id" INTO NEW."branch_id" FROM "orders" o WHERE o."id" = NEW."order_id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "print_jobs_fill_branch_trg"
  BEFORE INSERT ON "print_jobs"
  FOR EACH ROW EXECUTE FUNCTION "print_jobs_fill_branch"();
