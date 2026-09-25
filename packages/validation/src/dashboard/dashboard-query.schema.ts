import { z } from "zod";

export const MAX_DASHBOARD_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

/** `?shopId=` only: the operator and printer dashboards have no period. */
export const shopDashboardQuerySchema = z.object({
  shopId: z.string().uuid(),
});
export type ShopDashboardQueryInput = z.infer<typeof shopDashboardQuerySchema>;

/** The owner dashboard's optional period. Both bounds are optional ISO dates;
 * `to` defaults to now and `from` to seven days before `to`. A range is bounded
 * (at most 366 days) and must run forwards, so a query can never scan the whole
 * table by accident. */
export const ownerDashboardQuerySchema = shopDashboardQuerySchema
  .extend({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    const to = value.to ?? new Date();
    const from = value.from ?? new Date(to.getTime() - 7 * DAY_MS);
    if (from >= to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "`from` must be before `to`." });
    } else if (to.getTime() - from.getTime() > MAX_DASHBOARD_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: `The range may not exceed ${MAX_DASHBOARD_RANGE_DAYS} days.`,
      });
    }
  });
export type OwnerDashboardQueryInput = z.infer<typeof ownerDashboardQuerySchema>;

/** The operator dashboard's lists are each capped: `?limit=` (1-100, default 25). */
export const operatorDashboardQuerySchema = shopDashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type OperatorDashboardQueryInput = z.infer<typeof operatorDashboardQuerySchema>;
