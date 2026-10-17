-- Per-person staff access: what a membership holds on top of (or without) its role's defaults.
-- Both arrays store only the DIFFERENCE from the role's defaults, so a later change to a role's
-- defaults still reaches everyone who was not customised on that permission. Purely additive:
-- existing rows get empty arrays and keep exactly their role's permissions.
ALTER TABLE "shop_staff"
  ADD COLUMN "extra_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "removed_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
