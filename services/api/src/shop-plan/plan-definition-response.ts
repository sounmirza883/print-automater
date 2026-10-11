import type { Prisma } from "@prisma/client";
import type { PlanDefinitionResponse, PublicPlan } from "@print-automated/types";

/** Every read of a plan definition that is returned to a client includes this:
 * `subscriberCount` is a live count of the `shop_plans` rows assigned to it
 * (active or expired) -- "how many businesses are on this plan", never a cached
 * number that could drift from the assignments themselves. `featureValues` are the
 * plan's Compare-table cells. */
export const PLAN_DEFINITION_WITH_COUNT = {
  _count: { select: { shopPlans: true } },
  featureValues: true,
} satisfies Prisma.PlanDefinitionInclude;

export type PlanDefinitionWithCount = Prisma.PlanDefinitionGetPayload<{
  include: typeof PLAN_DEFINITION_WITH_COUNT;
}>;

/** What the public marketing site may see of a plan: the offer itself, never
 * the admin-only parts (`id`, `archived`, `subscriberCount`, timestamps). */
export function toPublicPlanResponse(
  row: Pick<
    PlanDefinitionWithCount,
    | "name"
    | "priceMinor"
    | "currency"
    | "billingPeriodDays"
    | "description"
    | "annualPriceMinor"
    | "highlighted"
    | "contactOnly"
  >,
): PublicPlan {
  return {
    name: row.name,
    priceMinor: row.priceMinor,
    currency: row.currency,
    billingPeriodDays: row.billingPeriodDays,
    description: row.description,
    annualPriceMinor: row.annualPriceMinor,
    highlighted: row.highlighted,
    contactOnly: row.contactOnly,
  };
}

export function toPlanDefinitionResponse(row: PlanDefinitionWithCount): PlanDefinitionResponse {
  return {
    id: row.id,
    name: row.name,
    priceMinor: row.priceMinor,
    currency: row.currency,
    billingPeriodDays: row.billingPeriodDays,
    description: row.description,
    archived: row.archived,
    annualPriceMinor: row.annualPriceMinor,
    highlighted: row.highlighted,
    contactOnly: row.contactOnly,
    sortOrder: row.sortOrder,
    values: Object.fromEntries(row.featureValues.map((v) => [v.featureId, v.value])),
    subscriberCount: row._count.shopPlans,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
