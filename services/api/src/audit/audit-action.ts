/** Grows one entry per phase, as each phase's own actions come into
 * existence -- §83 lists the full eventual vocabulary, but most of it
 * (ORDER_CREATED, PRINT_STARTED, ...) names features that don't exist
 * yet. record() accepts any string; this is just autocomplete for the
 * actions this phase actually produces. */
export const AuditAction = {
  REGISTER: "REGISTER",
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  DOCUMENT_ACCESSED: "DOCUMENT_ACCESSED",
  // §45/16.6.
  PAYMENT_STATUS_CHANGED: "PAYMENT_STATUS_CHANGED",
  REFUND_SUCCEEDED: "REFUND_SUCCEEDED",
  REFUND_FAILED: "REFUND_FAILED",
  PRINTER_CREATED: "PRINTER_CREATED",
  PRINTER_UPDATED: "PRINTER_UPDATED",
  PRINTER_REMOVED: "PRINTER_REMOVED",
  PAIRING_CODE_ISSUED: "PAIRING_CODE_ISSUED",
  PAIRING_CODE_REDEEMED: "PAIRING_CODE_REDEEMED",
  SHOP_STAFF_ADDED: "SHOP_STAFF_ADDED",
  SHOP_STAFF_ROLE_CHANGED: "SHOP_STAFF_ROLE_CHANGED",
  SHOP_STAFF_REMOVED: "SHOP_STAFF_REMOVED",
  // 23.15: add-by-email (an invitation, or a direct add of an existing account).
  SHOP_STAFF_INVITED: "SHOP_STAFF_INVITED",
  SHOP_STAFF_INVITE_ACCEPTED: "SHOP_STAFF_INVITE_ACCEPTED",
  SHOP_STAFF_INVITE_REVOKED: "SHOP_STAFF_INVITE_REVOKED",
  // §13/17.3.
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  // §19/§20/17.3.
  PRICING_RULE_CREATED: "PRICING_RULE_CREATED",
  // §33/34/17.4.
  CUSTOMER_CREATED: "CUSTOMER_CREATED",
  CUSTOMER_UPDATED: "CUSTOMER_UPDATED",
  // §4.2/11/17.5.
  COUNTER_ORDER_CREATED: "COUNTER_ORDER_CREATED",
  // §35/17.6.
  MANUAL_PAYMENT_RECORDED: "MANUAL_PAYMENT_RECORDED",
  // §36/17.7.
  INVOICE_DOWNLOADED: "INVOICE_DOWNLOADED",
  // §20/§80/18.7.
  JOB_REASSIGNED: "JOB_REASSIGNED",
  // §21/18.9.
  JOB_OPERATOR_ASSIGNED: "JOB_OPERATOR_ASSIGNED",
  // 66/21.2: the operator's failure-reason pick on a failed job.
  JOB_FAILURE_REASON_RECORDED: "JOB_FAILURE_REASON_RECORDED",
  // 67/21.4: a reprint of a printed job (audit row on the NEW job).
  JOB_REPRINT_CREATED: "JOB_REPRINT_CREATED",
  // 71/21.5: the optional delivery workflow (the address is never put in metadata).
  DELIVERY_DETAILS_SAVED: "DELIVERY_DETAILS_SAVED",
  DELIVERY_STATUS_CHANGED: "DELIVERY_STATUS_CHANGED",
  // 26/27/20.2. Every stock movement itself is audited by applyStockMovement as
  // INVENTORY_MOVEMENT; these two cover the item's own metadata.
  INVENTORY_ITEM_CREATED: "INVENTORY_ITEM_CREATED",
  INVENTORY_ITEM_UPDATED: "INVENTORY_ITEM_UPDATED",
  // 28/20.3: the shop-level tracking toggle.
  INVENTORY_TRACKING_CHANGED: "INVENTORY_TRACKING_CHANGED",
  // 29/30/20.6.
  SUPPLIER_CREATED: "SUPPLIER_CREATED",
  SUPPLIER_UPDATED: "SUPPLIER_UPDATED",
  SUPPLIER_PRODUCT_LINKED: "SUPPLIER_PRODUCT_LINKED",
  SUPPLIER_PRODUCT_UPDATED: "SUPPLIER_PRODUCT_UPDATED",
  SUPPLIER_PRODUCT_UNLINKED: "SUPPLIER_PRODUCT_UNLINKED",
  // 31/20.7.
  PURCHASE_ORDER_CREATED: "PURCHASE_ORDER_CREATED",
  PURCHASE_ORDER_UPDATED: "PURCHASE_ORDER_UPDATED",
  PURCHASE_ORDER_ORDERED: "PURCHASE_ORDER_ORDERED",
  PURCHASE_ORDER_CANCELLED: "PURCHASE_ORDER_CANCELLED",
  PURCHASE_ORDER_RECEIVED: "PURCHASE_ORDER_RECEIVED",
  PURCHASE_ORDER_PAYMENT_CHANGED: "PURCHASE_ORDER_PAYMENT_CHANGED",
  // 75/76/22.1: any change to a shop's settings (metadata: before/after of the
  // changed keys, versions). Printer automation rules (22.3) have their own actions.
  SHOP_SETTINGS_CHANGED: "SHOP_SETTINGS_CHANGED",
  // 77/22.3: printer automation rules (metadata: before/after, versions).
  PRINTER_RULE_CREATED: "PRINTER_RULE_CREATED",
  PRINTER_RULE_UPDATED: "PRINTER_RULE_UPDATED",
  PRINTER_RULE_DELETED: "PRINTER_RULE_DELETED",
  PRINTER_RULES_REORDERED: "PRINTER_RULES_REORDERED",
  // Workstream A (admin panel business management): an admin creating a
  // business, or changing its status, outside that business's own staff.
  SHOP_CREATED: "SHOP_CREATED",
  SHOP_STATUS_CHANGED: "SHOP_STATUS_CHANGED",
  // Workstream B (admin panel user management): an admin changing a
  // user's platform-wide role or status (distinct from SHOP_STAFF_ROLE_CHANGED,
  // which is per-shop and self-service).
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_STATUS_CHANGED: "USER_STATUS_CHANGED",
  // 24.1 (QR guest ordering): a guest placed an order from the shop's QR
  // code. Actor = the shop's SYSTEM user; the guest's name/phone appear
  // only masked (common/mask.ts).
  QR_ORDER_CREATED: "QR_ORDER_CREATED",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
