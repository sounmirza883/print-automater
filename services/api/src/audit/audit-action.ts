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
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
