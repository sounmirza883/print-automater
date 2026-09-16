-- DropIndex
DROP INDEX "refunds_payment_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_key" ON "refunds"("payment_id");
