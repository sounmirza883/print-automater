import type { Prisma } from "@prisma/client";
import type { PlanDefinitionResponse } from "@print-automated/types";

/** Every read of a plan definition that is returned to a client includes this:
 * `subscriberCount` is a live count of the `shop_plans` rows assigned to it
 * (active or expired) -- "how many businesses are on this plan", never a cached
 * number that could drift from the assignments themselves. */
export const PLAN_DEFINITION_WITH_COUNT = {
  _count: { select: { shopPlans: true } },
} satisfies Prisma.PlanDefinitionInclude;

export type PlanDefinitionWithCount = Prisma.PlanDefinitionGetPayload<{
  include: typeof PLAN_DEFINITION_WITH_COUNT;
}>;

export function toPlanDefinitionResponse(row: PlanDefinitionWithCount): PlanDefinitionResponse {
  return {
    id: row.id,
    name: row.name,
    priceMinor: row.priceMinor,
    currency: row.currency,
    billingPeriodDays: row.billingPeriodDays,
    description: row.description,
    archived: row.archived,
    subscriberCount: row._count.shopPlans,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
