import { z } from "zod";

const optionalText = z.string().trim().min(1).max(100).nullable().optional();

/** 21.5 (§71). Create or update an order's delivery details. Fields left out are
 * kept; `null` clears courier/tracking. The fee is in minor units and is
 * recorded only: it never changes the order's price. */
export const saveDeliverySchema = z.object({
  address: z.string().trim().min(5).max(500),
  courier: optionalText,
  trackingNumber: optionalText,
  feeMinor: z.number().int().min(0).max(1_000_000_000).optional(),
});
export type SaveDeliveryInput = z.infer<typeof saveDeliverySchema>;

/** The statuses staff move a delivery to (PENDING is only the starting state). */
export const DELIVERY_TARGET_STATUSES = [
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;

export const deliveryStatusSchema = z.object({
  status: z.enum(DELIVERY_TARGET_STATUSES),
  /** Handing over to a courier needs one; it may be supplied with the change. */
  courier: optionalText,
  trackingNumber: optionalText,
});
export type DeliveryStatusInput = z.infer<typeof deliveryStatusSchema>;
