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
 *  - raise: candidate rows are locked (`FOR UPDATE SKIP LOCKED`, ascending id) and
 *    then claimed by an UPDATE guarded on `low_stock_alerted_at IS NULL`; a
 *    concurrent tick skips rows this one holds (or, after commit, sees the latch),
 *    so it inserts no second alert. The claim and the alert insert share one
 *    transaction, so a failed insert releases the claim (retried next tick).
 *  - resolve: symmetric `UPDATE .. SET low_stock_alerted_at = NULL WHERE
 *    alerted AND NOT low RETURNING`, then the OPEN alerts of exactly those items
 *    are RESOLVED. A later drop re-latches and raises a NEW alert.
 * The per-shop alerts toggle (22.2) is read in the same statement that picks the
 * candidates, without a lock: a toggle write racing a tick is simply ordered before
 * or after it, and the next tick honours the committed value.
 * A stock write racing this sweep is fine either way: the next tick sees the
 * committed quantity. Pure of Nest/Redis; the worker schedules it. */
export async function syncLowStockAlerts(prisma: PrismaService): Promise<LowStockSyncResult> {
  return prisma.$transaction(
    async (tx) => {
      // Lock order (20.9): candidate rows are locked FIRST, in ascending id, with
      // SKIP LOCKED, and only then updated by id. Consumption and purchase-order
      // receipt also lock item rows in ascending id, so this sweep can never
      // deadlock against them; a row someone else holds is simply skipped this
      // tick (its writer's change is picked up on the next one) instead of
      // queueing behind a print completion.
      const resolveCandidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT i.id
        FROM inventory_items AS i
        WHERE i.low_stock_alerted_at IS NOT NULL
          AND NOT (
            i.active AND i.min_quantity > 0 AND i.quantity <= i.min_quantity
            AND EXISTS (
              SELECT 1 FROM shops s WHERE s.id = i.shop_id AND s.inventory_tracking_enabled
            )
          )
        ORDER BY i.id
        FOR UPDATE OF i SKIP LOCKED
      `;
      const resolvedItems =
        resolveCandidates.length === 0
          ? []
          : await tx.$queryRaw<Array<{ id: string }>>`
              UPDATE inventory_items
              SET low_stock_alerted_at = NULL
              WHERE id = ANY(${resolveCandidates.map((row) => row.id)}::text[])
              RETURNING id
            `;
      if (resolvedItems.length > 0) {
        await tx.$executeRaw`
          UPDATE inventory_alerts
          SET status = 'RESOLVED'::"InventoryAlertStatus", resolved_at = now()
          WHERE status = 'OPEN'::"InventoryAlertStatus"
            AND inventory_item_id = ANY(${resolvedItems.map((row) => row.id)}::text[])
        `;
      }

      const raiseCandidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT i.id
        FROM inventory_items AS i
        JOIN shops AS s ON s.id = i.shop_id
        WHERE s.inventory_tracking_enabled
          -- 22.2 (PRD 76): the shop can switch automatic inventory alerts off. That
          -- stops NEW alerts only; an open alert still resolves when stock recovers.
          -- (No shop_settings row = default on; the migration guarantees a row.)
          AND NOT EXISTS (
            SELECT 1 FROM shop_settings ss
            WHERE ss.shop_id = i.shop_id AND NOT ss.inventory_alerts_enabled
          )
          AND i.active
          AND i.min_quantity > 0
          AND i.quantity <= i.min_quantity
          AND i.low_stock_alerted_at IS NULL
        ORDER BY i.id
        FOR UPDATE OF i SKIP LOCKED
      `;
      // Re-check under the lock (defence in depth; the rows are ours now).
      const raisedItems =
        raiseCandidates.length === 0
          ? []
          : await tx.$queryRaw<
              Array<{ id: string; shopId: string; quantity: number; minQuantity: number }>
            >`
              UPDATE inventory_items
              SET low_stock_alerted_at = now()
              WHERE id = ANY(${raiseCandidates.map((row) => row.id)}::text[])
                AND low_stock_alerted_at IS NULL
                AND min_quantity > 0 AND quantity <= min_quantity
              RETURNING id, shop_id AS "shopId", quantity, min_quantity AS "minQuantity"
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
