-- 23.15: pending staff invitations by email (see the model comment in schema.prisma).
-- Additive: one new table, nothing existing changes.
CREATE TABLE "shop_staff_invites" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_staff_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_staff_invites_token_hash_key" ON "shop_staff_invites"("token_hash");
CREATE UNIQUE INDEX "shop_staff_invites_shop_id_email_key" ON "shop_staff_invites"("shop_id", "email");
CREATE INDEX "shop_staff_invites_email_idx" ON "shop_staff_invites"("email");

ALTER TABLE "shop_staff_invites" ADD CONSTRAINT "shop_staff_invites_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
