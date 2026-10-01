import { z } from "zod";

/** 26.4, extended for plan definitions: `POST /admin/businesses/:shopId/plan/activate`.
 * Assigns (or re-assigns, to renew) a named plan to a business -- the days to extend
 * by come from that plan's own `billingPeriodDays`, not a client-supplied number,
 * so "activate" and "renew" are the same call: pick the same plan again to renew,
 * pick a different one to change plans. Extends (or starts) from the LATER of now
 * or the current expiry, same semantics `ShopPlanService.activate` already had. */
export const activatePlanSchema = z.object({
  planDefinitionId: z.string().uuid(),
});

export type ActivatePlanInput = z.infer<typeof activatePlanSchema>;
