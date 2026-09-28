import { z } from "zod";

/** 26.4: `POST /admin/businesses/:shopId/plan/activate`. Extends (or starts) a
 * shop's plan by this many days from the later of now or its current expiry --
 * renewing early adds to what's left rather than discarding it (ShopPlanService).
 * Capped at 3650 (10 years): a typo should not silently grant a decade. */
export const activatePlanSchema = z.object({
  days: z.number().int().min(1).max(3650),
});

export type ActivatePlanInput = z.infer<typeof activatePlanSchema>;
