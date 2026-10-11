-- Manual plan billing: owners submit proof of an off-app payment; a platform admin
-- approves (granting N months) or rejects. Proof files live in S3 forever -- this
-- migration deliberately adds no delete path. Plus a singleton row for the
-- admin-edited "payment instructions" text.
CREATE TYPE "PaymentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "payment_proofs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "submitted_by_user_id" TEXT NOT NULL,
    "plan_definition_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "transaction_ref" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_content_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "granted_months" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_proofs_amount_positive" CHECK ("amount_minor" > 0),
    CONSTRAINT "payment_proofs_transaction_ref_not_blank" CHECK (length(btrim("transaction_ref")) > 0),
    CONSTRAINT "payment_proofs_granted_months_positive" CHECK ("granted_months" IS NULL OR "granted_months" > 0),
    -- A decision always carries who/when; APPROVED carries the months, REJECTED the reason.
    CONSTRAINT "payment_proofs_review_fields" CHECK (
      ("status" = 'PENDING' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
      OR ("status" = 'APPROVED' AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "granted_months" IS NOT NULL)
      OR ("status" = 'REJECTED' AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "rejection_reason" IS NOT NULL)
    )
);

CREATE INDEX "payment_proofs_status_created_at_idx" ON "payment_proofs"("status", "created_at");
CREATE INDEX "payment_proofs_shop_id_created_at_idx" ON "payment_proofs"("shop_id", "created_at");
CREATE INDEX "payment_proofs_transaction_ref_idx" ON "payment_proofs"("transaction_ref");

-- At most one PENDING proof per business at a time.
CREATE UNIQUE INDEX "payment_proofs_one_pending_per_shop"
  ON "payment_proofs"("shop_id") WHERE "status" = 'PENDING';

ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_plan_definition_id_fkey"
  FOREIGN KEY ("plan_definition_id") REFERENCES "plan_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "payment_instructions" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_settings_singleton" CHECK ("id" = 1)
);

INSERT INTO "platform_settings" ("id") VALUES (1);
