import type { NotificationTarget } from "@print-automated/types";

/** Fired after mark-read / read-all so the header bell re-counts at once. */
export const NOTIFICATIONS_CHANGED_EVENT = "pa:notifications-changed";

/** Where "open the related object" goes (PRD 111). A print job has no
 * page of its own: it opens its ORDER (which lists the job), so a
 * job alert without an `orderId` falls back to the queue. Purchase-order
 * and inventory-item pages arrive with the 23.4 screens; until then those
 * routes show the section's placeholder, which is still the right place
 * to land. */
export function notificationHref(target: NotificationTarget | null): string | null {
  if (target === null) {
    return null;
  }
  const id = encodeURIComponent(target.id);
  switch (target.type) {
    case "ORDER":
      return `/orders/${id}`;
    case "PRINT_JOB":
      return target.orderId !== null
        ? `/orders/${encodeURIComponent(target.orderId)}?job=${id}`
        : "/orders";
    case "PRINTER":
      return `/printers/${id}`;
    case "INVENTORY_ITEM":
      return `/inventory/${id}`;
    case "PURCHASE_ORDER":
      return `/purchase-orders/${id}`;
    default:
      return null;
  }
}

/** A short link label for the target ("Open order", "Open printer"). */
export function notificationLinkLabel(target: NotificationTarget | null): string | null {
  switch (target?.type) {
    case "ORDER":
      return "Open order";
    case "PRINT_JOB":
      return target.orderId !== null ? "Open order and job" : "Open queue";
    case "PRINTER":
      return "Open printer";
    case "INVENTORY_ITEM":
      return "Open stock item";
    case "PURCHASE_ORDER":
      return "Open purchase order";
    default:
      return null;
  }
}
