-- 23.11: trigram indexes for the searched columns 23.6 left unindexed (every column a q/search
-- term can match must be indexed, or that search is a sequential scan).
--
-- PRODUCTION NOTE: plain CREATE INDEX takes a write lock on the table while it builds (and
-- Prisma runs migrations inside a transaction, where CONCURRENTLY is not allowed). On a large
-- production database create these by hand first, in a maintenance window, with
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS <name> ON <table> USING GIN (<col> gin_trgm_ops);
-- then this migration is a no-op for them (IF NOT EXISTS).
CREATE INDEX IF NOT EXISTS "users_phone_trgm_idx" ON "users" USING GIN ("phone" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "printers_model_trgm_idx" ON "printers" USING GIN ("model" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "printers_location_trgm_idx" ON "printers" USING GIN ("location" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_description_trgm_idx" ON "products" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "products_category_trgm_idx" ON "products" USING GIN ("category" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "customers_company_trgm_idx" ON "customers" USING GIN ("company" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "inventory_items_sku_trgm_idx" ON "inventory_items" USING GIN ("sku" gin_trgm_ops);
