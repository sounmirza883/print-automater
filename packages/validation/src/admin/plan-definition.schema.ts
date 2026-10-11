import { z } from "zod";

/** "true" = tick, "false" = dash, anything else is the text shown. */
export const planFeatureValueSchema = z.string().trim().min(1).max(60);
/** featureId -> value; replaces the plan's whole set of values. */
export const planValuesSchema = z.record(z.string().uuid(), planFeatureValueSchema);
const annualPrice = z.number().int().min(0).max(100_000_000);
const sortOrder = z.number().int().min(0).max(1000);

/** A platform-wide plan tier (name/price/currency/billing period) an admin
 * defines and assigns to businesses -- never a field a client can smuggle `id`,
 * `archived`, or `subscriberCount` into, matching this codebase's "no field a
 * client can smuggle in" discipline used for every other admin create schema. */
export const createPlanDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceMinor: z.number().int().min(0).max(100_000_000),
  /** Matches ShopSettings.currency's own rule exactly. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter upper-case currency code."),
  billingPeriodDays: z.number().int().min(1).max(3650),
  description: z.string().trim().max(500).optional(),
  annualPriceMinor: annualPrice.optional(),
  highlighted: z.boolean().optional(),
  contactOnly: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
  values: planValuesSchema.optional(),
});

export type CreatePlanDefinitionInput = z.infer<typeof createPlanDefinitionSchema>;

/** `PATCH /admin/plans/:id` -- every field optional (a partial update), plus
 * `archived` (not settable on create: a brand-new plan is never born archived). */
export const updatePlanDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  priceMinor: z.number().int().min(0).max(100_000_000).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter upper-case currency code.")
    .optional(),
  billingPeriodDays: z.number().int().min(1).max(3650).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  archived: z.boolean().optional(),
  annualPriceMinor: annualPrice.nullable().optional(),
  highlighted: z.boolean().optional(),
  contactOnly: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
  values: planValuesSchema.optional(),
});

export type UpdatePlanDefinitionInput = z.infer<typeof updatePlanDefinitionSchema>;
