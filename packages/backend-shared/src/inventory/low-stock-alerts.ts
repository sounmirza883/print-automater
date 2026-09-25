import type { PrismaService } from "../prisma/prisma.service.js";

export interface LowStockSyncResult {
  raised: number;
  resolved: number;
}

/** 20.5 / PRD 32. One sweep of the low-stock alert state machine, for shops
 * with inventory tracking enabled (default off: no shop is alerted about stock
 * it never asked to track). The condition is `isLowStock()`'s, in SQL:
 * min_quantity > 0 AND quantity <= min_quantity, on an active item.
 *
 * Race-safe by construction, not by a lock around the whole sweep:
 *  - raise: a single `UPDATE .. SET low_stock_alerted_at = now() WHERE ..
 *    low_stock_alerted_at IS NULL RETURNING ..` claims each item once; a
 *    concurrent tick blocks on the row, re-evaluates the WHERE, and gets nothing
 *    back, so it inserts no alert. The claim and the alert insert share one
 *    transaction, so a failed insert releases the claim (retried next tick).
 *  - resolve: symmetric `UPDATE .. SET low_stock_alerted_at = NULL WHERE
 *    alerted AND NOT low RETURNING`, then the OPEN alerts of exactly those items
 *    are RESOLVED. A later drop re-latches and raises a NEW alert.
 * A stock write racing this sweep is fine either way: the next tick sees the
 * committed quantity. Pure of Nest/Redis; the worker schedules it. */
export async function syncLowStockAlerts(prisma: PrismaService): Promise<LowStockSyncResult> {
  return prisma.$transaction(
    async (tx) => {
      const resolvedItems = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE inventory_items AS i
        SET low_stock_alerted_at = NULL
        WHERE i.low_stock_alerted_at IS NOT NULL
          AND NOT (
            i.active AND i.min_quantity > 0 AND i.quantity <= i.min_quantity
            AND EXISTS (
              SELECT 1 FROM shops s WHERE s.id = i.shop_id AND s.inventory_tracking_enabled
            )
          )
        RETURNING i.id
      `;
      if (resolvedItems.length > 0) {
        await tx.$executeRaw`
          UPDATE inventory_alerts
          SET status = 'RESOLVED'::"InventoryAlertStatus", resolved_at = now()
          WHERE status = 'OPEN'::"InventoryAlertStatus"
            AND inventory_item_id = ANY(${resolvedItems.map((row) => row.id)}::text[])
        `;
      }

      const raisedItems = await tx.$queryRaw<
        Array<{ id: string; shopId: string; quantity: number; minQuantity: number }>
      >`
        UPDATE inventory_items AS i
        SET low_stock_alerted_at = now()
        FROM shops AS s
        WHERE s.id = i.shop_id
          AND s.inventory_tracking_enabled
          AND i.active
          AND i.min_quantity > 0
          AND i.quantity <= i.min_quantity
          AND i.low_stock_alerted_at IS NULL
        RETURNING i.id AS id, i.shop_id AS "shopId", i.quantity AS quantity,
                  i.min_quantity AS "minQuantity"
      `;
      if (raisedItems.length > 0) {
        await tx.inventoryAlert.createMany({
          data: raisedItems.map((row) => ({
            shopId: row.shopId,
            inventoryItemId: row.id,
            quantityAtAlert: row.quantity,
            minQuantity: row.minQuantity,
          })),
        });
      }
      return { raised: raisedItems.length, resolved: resolvedItems.length };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
