import { z } from "zod";

const section = z.string().trim().min(1).max(60);
const label = z.string().trim().min(1).max(100);
const sortOrder = z.number().int().min(0).max(1000);
const cardText = z.string().trim().min(1).max(120);

/** A row of the public Compare plans table. `id` is never client-supplied. */
export const createPlanFeatureSchema = z.object({
  section,
  label,
  sortOrder: sortOrder.optional(),
  showOnCard: z.boolean().optional(),
  cardText: cardText.optional(),
});

export type CreatePlanFeatureInput = z.infer<typeof createPlanFeatureSchema>;

/** `PATCH /admin/plan-features/:id` -- partial; `cardText: null` clears the template. */
export const updatePlanFeatureSchema = z.object({
  section: section.optional(),
  label: label.optional(),
  sortOrder: sortOrder.optional(),
  showOnCard: z.boolean().optional(),
  cardText: cardText.nullable().optional(),
});

export type UpdatePlanFeatureInput = z.infer<typeof updatePlanFeatureSchema>;
