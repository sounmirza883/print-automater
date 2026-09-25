-- 23.2 (PRD 39-42): dashboards, and later reports/search, aggregate per shop. orders
-- had no shop_id index at all and print_jobs only a bare one, so every aggregate
-- would have scanned the whole table. Additive, no data change.
CREATE INDEX "orders_shop_id_order_status_idx" ON "orders"("shop_id", "order_status");
CREATE INDEX "orders_shop_id_created_at_idx" ON "orders"("shop_id", "created_at");
CREATE INDEX "print_jobs_shop_id_status_updated_at_idx" ON "print_jobs"("shop_id", "status", "updated_at");
CREATE INDEX "print_jobs_operator_id_status_idx" ON "print_jobs"("operator_id", "status");
CREATE INDEX "payments_status_updated_at_idx" ON "payments"("status", "updated_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
