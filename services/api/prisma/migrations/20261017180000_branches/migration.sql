-- Branches: a business ("shops") can run several physical locations. This step only lays the
-- foundation (the table, who belongs where); orders, printers and stock are split by branch in
-- later steps.
--
-- Additive and safe next to older code on the shared dev database:
--   * every shop gets one branch (backfilled here, and by a trigger for every later shop), so
--     code that only inserts a shop keeps working;
--   * the new staff/invite column is nullable and NULL means "All branches", which is exactly
--     how every member behaved before branches existed.
CREATE TABLE "branches" (
  "id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT,
  "address" TEXT NOT NULL,
  "phone" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "is_open" BOOLEAN NOT NULL DEFAULT true,
  "opening_hours" JSONB,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_shop_id_name_key" ON "branches"("shop_id", "name");
-- The target of composite foreign keys, so a row can never point at another business's branch.
CREATE UNIQUE INDEX "branches_id_shop_id_key" ON "branches"("id", "shop_id");
CREATE INDEX "branches_shop_id_idx" ON "branches"("shop_id");

ALTER TABLE "branches" ADD CONSTRAINT "branches_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing business gets exactly one branch: named after it, copying where it is, and open
-- (the business-level status stays the master switch over every branch).
INSERT INTO "branches" ("id", "shop_id", "name", "address", "phone", "latitude", "longitude", "opening_hours")
SELECT gen_random_uuid()::text, "id", "name", "address", "phone", "latitude", "longitude", "opening_hours"
FROM "shops";

-- Who belongs where. NULL = "All branches" (owners, and anyone an owner marks that way).
ALTER TABLE "shop_staff" ADD COLUMN "branch_id" TEXT;
ALTER TABLE "shop_staff_invites" ADD COLUMN "branch_id" TEXT;

-- MATCH SIMPLE: a NULL branch_id skips the check; a set one must be this shop's own branch.
ALTER TABLE "shop_staff" ADD CONSTRAINT "shop_staff_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "shop_staff_invites" ADD CONSTRAINT "shop_staff_invites_branch_shop_fkey"
  FOREIGN KEY ("branch_id", "shop_id") REFERENCES "branches"("id", "shop_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "shop_staff_branch_id_idx" ON "shop_staff"("branch_id");

-- Existing non-owners belong to their business's (single) branch; owners stay "All branches".
UPDATE "shop_staff" s SET "branch_id" = b."id"
FROM "branches" b
WHERE b."shop_id" = s."shop_id" AND s."role" <> 'SHOP_OWNER';
UPDATE "shop_staff_invites" i SET "branch_id" = b."id"
FROM "branches" b
WHERE b."shop_id" = i."shop_id" AND i."role" <> 'SHOP_OWNER';

-- Every later shop gets its first branch automatically, like its settings row.
CREATE FUNCTION "shops_create_first_branch"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "branches" ("id", "shop_id", "name", "address", "phone", "latitude", "longitude", "opening_hours")
  VALUES (gen_random_uuid()::text, NEW."id", NEW."name", NEW."address", NEW."phone", NEW."latitude", NEW."longitude", NEW."opening_hours");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shops_create_first_branch_trg"
  AFTER INSERT ON "shops"
  FOR EACH ROW EXECUTE FUNCTION "shops_create_first_branch"();
