import { z } from "zod";
import { registerSchema } from "../auth/register.schema.js";
import { createPricingRuleSchema } from "../pricing-rules/create-pricing-rule.schema.js";

/** Self-service business signup (definition-of-done.md #1): a prospective
 * business creates its Shop, its own SHOP_OWNER account, and version-1
 * pricing all in one call, no ops/seed involvement. Deliberately reuses
 * `registerSchema` for the owner sub-object (same account-creation rules
 * `POST /auth/register` already enforces) and `createPricingRuleSchema`
 * for the pricing sub-object (same shape `POST /shop/pricing-rules`
 * already enforces), minus `shopId` -- the shop doesn't exist yet when
 * this request is validated, so the service assigns it after creating
 * the shop, exactly like `upsertPricingRule` does in seed.ts. */
export const registerShopSchema = z.object({
  shop: z.object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().min(1).max(500),
    phone: z.string().trim().min(1).max(30).optional(),
    capabilities: z.object({
      color: z.boolean(),
      duplex: z.boolean(),
      a4: z.boolean(),
      a3: z.boolean(),
    }),
  }),
  owner: registerSchema,
  pricing: createPricingRuleSchema.omit({ shopId: true }),
});

export type RegisterShopInput = z.infer<typeof registerShopSchema>;
