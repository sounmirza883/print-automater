-- 24.1 (QR guest ordering). Additive only: two new enum values and one
-- new nullable column, so every existing row is unaffected.
--
-- UserRole.SYSTEM: a shop's synthetic QR-order account (never a person).
-- Same one-ALTER-per-value pattern as 16.1's add_staff_roles migration.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SYSTEM';

-- OrderCreationSource.QR: an order a guest placed from the shop's QR code.
ALTER TYPE "OrderCreationSource" ADD VALUE IF NOT EXISTS 'QR';

-- Shop.qrSystemUserId: nullable, lazily set on the shop's first QR request.
ALTER TABLE "shops" ADD COLUMN "qr_system_user_id" TEXT;

CREATE UNIQUE INDEX "shops_qr_system_user_id_key" ON "shops"("qr_system_user_id");

ALTER TABLE "shops" ADD CONSTRAINT "shops_qr_system_user_id_fkey" FOREIGN KEY ("qr_system_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
