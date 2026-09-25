-- 23.7 (PRD 37/111): the staff notification centre. Additive: a new table and two enums,
-- no change to the customer `notifications` table. See the model comment in schema.prisma.
CREATE TYPE "StaffNotificationType" AS ENUM ('LOW_STOCK', 'JOB_BLOCKED', 'JOB_HELD_LATE_PRINT', 'JOB_FAILED');
CREATE TYPE "NotificationTargetType" AS ENUM ('ORDER', 'PRINT_JOB', 'PRINTER', 'INVENTORY_ITEM', 'PURCHASE_ORDER');

CREATE TABLE "staff_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "type" "StaffNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "target_type" "NotificationTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "order_id" TEXT,
    "metadata" JSONB,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_notifications_user_id_dedupe_key_key" ON "staff_notifications"("user_id", "dedupe_key");
CREATE INDEX "staff_notifications_user_id_created_at_idx" ON "staff_notifications"("user_id", "created_at");
CREATE INDEX "staff_notifications_user_id_read_at_idx" ON "staff_notifications"("user_id", "read_at");
CREATE INDEX "staff_notifications_shop_id_idx" ON "staff_notifications"("shop_id");

ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
