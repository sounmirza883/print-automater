-- 23.6 (PRD 43): search is ILIKE '%term%' over names, phones, order numbers and file
-- names. A btree cannot serve a leading-wildcard match, so each searched column gets a
-- pg_trgm GIN index. Additive, no data change. pg_trgm is a trusted extension (PG13+), so
-- the database owner can create it.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX "customers_email_trgm_idx" ON "customers" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "documents_filename_trgm_idx" ON "documents" USING GIN ("filename" gin_trgm_ops);
CREATE INDEX "orders_public_order_number_trgm_idx" ON "orders" USING GIN ("public_order_number" gin_trgm_ops);
CREATE INDEX "printers_name_trgm_idx" ON "printers" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "inventory_items_name_trgm_idx" ON "inventory_items" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "suppliers_name_trgm_idx" ON "suppliers" USING GIN ("name" gin_trgm_ops);
