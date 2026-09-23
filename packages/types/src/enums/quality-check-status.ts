/** §68/15.4/18.2. `orders.quality_check_status` is a plain string column
 * (15.4's own schema comment: the real QC workflow, and therefore the
 * final shape of this set, is Phase 21.3's decision to make) -- this is
 * the fixed vocabulary `aggregateOrderStatus()` and the real 21.3
 * workflow both key off today. NOT_REQUIRED is the default for every
 * shop with `qualityCheckEnabled: false`. */
export const QualityCheckStatus = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  PASSED: "PASSED",
  FAILED: "FAILED",
} as const;

export type QualityCheckStatus = (typeof QualityCheckStatus)[keyof typeof QualityCheckStatus];
