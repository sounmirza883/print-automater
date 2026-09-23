import { z } from "zod";

export const listPricingRulesQuerySchema = z.object({
  shopId: z.string().uuid(),
});

export type ListPricingRulesQueryInput = z.infer<typeof listPricingRulesQuerySchema>;
