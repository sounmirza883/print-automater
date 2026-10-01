import { z } from "zod";

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
});

export type UpdatePlanDefinitionInput = z.infer<typeof updatePlanDefinitionSchema>;
