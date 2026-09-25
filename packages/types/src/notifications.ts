/** 23.7 (PRD 37/111): one entry of the notification centre, for a customer's order notices
 * and for a staff member's operational alerts alike. */
export type NotificationCategory = "CUSTOMER_ORDER" | "STAFF_ALERT";

export type NotificationTargetKind =
  "ORDER" | "PRINT_JOB" | "PRINTER" | "INVENTORY_ITEM" | "PURCHASE_ORDER";

/** What "open the related object" should open. `orderId` is set whenever the target
 * belongs to an order (a print job does), so a client can also offer "open the order". */
export interface NotificationTarget {
  type: NotificationTargetKind;
  id: string;
  orderId: string | null;
}

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  /** CUSTOMER_ORDER: ORDER_ACCEPTED, PRINT_FAILED, ORDER_REJECTED ... STAFF_ALERT:
   * LOW_STOCK, JOB_BLOCKED, JOB_HELD_LATE_PRINT, JOB_FAILED. */
  type: string;
  title: string;
  body: string;
  /** The business a staff alert belongs to; null for a customer notice. */
  shopId: string | null;
  target: NotificationTarget | null;
  read: boolean;
  /** ISO timestamp, null while unread. Written by the mark-read endpoints. */
  readAt: string | null;
  createdAt: string;
}
