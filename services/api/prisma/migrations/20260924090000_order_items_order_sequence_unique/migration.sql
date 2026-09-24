-- 18.19: the synthetic OrderItem is created lazily at dispatch; make "one item
-- per (order, sequence)" a database guarantee rather than a caller-lock
-- convention. Pre-checked on the dev DB: zero existing duplicates.
CREATE UNIQUE INDEX "order_items_order_id_sequence_key" ON "order_items"("order_id", "sequence");
