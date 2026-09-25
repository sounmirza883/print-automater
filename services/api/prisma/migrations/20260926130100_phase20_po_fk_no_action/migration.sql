-- 20.7: RESTRICT is checked immediately, so deleting a shop (which cascades to
-- suppliers, items AND purchase orders) failed on the purchase-order FKs even
-- though everything referencing is being deleted in the same statement. NO ACTION
-- gives the same protection (a supplier or item that still has purchase orders
-- cannot be deleted on its own) but is checked at the end of the statement.
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplier_shop_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_shop_fkey"
  FOREIGN KEY ("supplier_id", "shop_id") REFERENCES "suppliers"("id", "shop_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_item_shop_fkey";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_shop_fkey"
  FOREIGN KEY ("inventory_item_id", "shop_id") REFERENCES "inventory_items"("id", "shop_id") ON DELETE NO ACTION ON UPDATE CASCADE;
