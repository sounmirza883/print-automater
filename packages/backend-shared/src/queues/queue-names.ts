/** Grows one entry per phase, as each phase's own queue comes into
 * existence -- 2.6's worker Build line names the eventual full set
 * (document-processing, notifications, print-dispatch, cleanup).
 * `order-expiration` isn't in that original list -- it's 5.6's own
 * self-scheduling repeatable job, produced and consumed entirely
 * within services/worker, not something services/api enqueues per
 * request the way document-processing is. Producer and consumer sides
 * must agree on the exact string, which is why this is the one
 * canonical source for it. */
export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
  ORDER_EXPIRATION: "order-expiration",
  NOTIFICATIONS: "notifications",
  // 9.4's own repeatable sweep -- the other half of "killing the agent
  // flips its printers to Offline within the threshold": nothing
  // proactively notices a missing heartbeat except this tick.
  PRINTER_OFFLINE_SWEEP: "printer-offline-sweep",
  // §109/10.5's own repeatable sweep -- the other half of "never stuck
  // in QUEUED forever": nothing proactively notices a job an agent
  // never claimed (or claimed and then went silent on) except this tick.
  PRINT_TIMEOUT: "print-timeout",
  // 11.4's own repeatable sweep -- compares local payment state against
  // the provider's own, flagging divergence rather than auto-correcting
  // money.
  PAYMENT_RECONCILIATION: "payment-reconciliation",
  // §66/§67/11.5's own repeatable sweep -- erases a completed order's
  // document once it's past the configurable retention window.
  DOCUMENT_RETENTION: "document-retention",
} as const;
