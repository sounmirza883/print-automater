-- 20.7: supersedes 20260926130100. NO ACTION still failed the shop-delete cascade
-- (Postgres runs each cascade level as its own statement). Suppliers and inventory
-- items are never deleted by the application (they are deactivated), so CASCADE
-- only matters when a whole shop is removed, which is exactly the case to support.
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplier_shop_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_shop_fkey"
  FOREIGN KEY ("supplier_id", "shop_id") REFERENCES "suppliers"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_item_shop_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_shop_fkey"
  FOREIGN KEY ("inventory_item_id", "shop_id") REFERENCES "inventory_items"("id", "shop_id") ON DELETE CASCADE ON UPDATE CASCADE;
