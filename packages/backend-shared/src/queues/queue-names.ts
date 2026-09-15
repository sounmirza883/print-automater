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
} as const;
