-- 23.10: revenue must be dated by a STABLE timestamp. It was bucketed by payments.updated_at,
-- so a refund (or any later touch of a PAID row) moved money between reporting periods.
-- paid_at is stamped once, by a trigger, the first time a payment enters a money state
-- (PAID, or a refund state, which can only follow PAID), and never changes afterwards.
ALTER TABLE "payments" ADD COLUMN "paid_at" TIMESTAMP(3);

-- Backfill: the earliest processed provider event, else the row's last update (the best
-- evidence left for manual payments, which have no events).
UPDATE "payments" p
SET "paid_at" = COALESCE(
  (SELECT MIN(pe."processed_at") FROM "payment_events" pe WHERE pe."payment_id" = p."id"),
  p."updated_at"
)
WHERE p."status" IN ('PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED');

CREATE OR REPLACE FUNCTION payments_stamp_paid_at() RETURNS trigger AS $$
BEGIN
  IF NEW."paid_at" IS NULL
     AND NEW."status" IN ('PAID', 'REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED') THEN
    NEW."paid_at" := now();
  END IF;
  -- once set it is immutable
  IF TG_OP = 'UPDATE' AND OLD."paid_at" IS NOT NULL THEN
    NEW."paid_at" := OLD."paid_at";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_stamp_paid_at
BEFORE INSERT OR UPDATE ON "payments"
FOR EACH ROW EXECUTE FUNCTION payments_stamp_paid_at();

CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");
CREATE INDEX "refunds_status_updated_at_idx" ON "refunds"("status", "updated_at");
