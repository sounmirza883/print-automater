import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import { formatCount, formatMoney } from "@/lib/format";

/** Plan management: how plans and a business's plan assignment read, and which
 * plan the picker starts on. Pure, so unit-tested; shared by the Plans page,
 * the Platform dashboard's plan table and a business's own Plan panel. */

/** 30 -> "30 days", 1 -> "1 day". */
export function billingPeriodLabel(days: number): string {
  return days === 1 ? "1 day" : `${formatCount(days)} days`;
}

/** "PKR 2,500.00 per 30 days". */
export function planPriceLabel(plan: PlanDefinitionResponse): string {
  return `${formatMoney(plan.priceMinor, plan.currency)} per ${billingPeriodLabel(plan.billingPeriodDays)}`;
}

/** One `<option>` in a plan picker: "Standard (PKR 2,500.00 per 30 days)". */
export function planOptionLabel(plan: PlanDefinitionResponse): string {
  return `${plan.name} (${planPriceLabel(plan)})`;
}

/** Archived plans stay on the businesses already assigned to them but can no
 * longer be newly assigned, so a picker offers only the rest. */
export function assignablePlans(
  plans: readonly PlanDefinitionResponse[],
): PlanDefinitionResponse[] {
  return plans.filter((plan) => !plan.archived);
}

/** The picker starts on the business's current plan when it can still be
 * chosen (so one click renews it), otherwise on the first assignable plan;
 * "" when there is nothing to choose. */
export function defaultPlanChoice(
  current: ShopPlanResponse | null,
  choices: readonly PlanDefinitionResponse[],
): string {
  const currentId = current?.plan?.id;
  if (currentId !== undefined && choices.some((plan) => plan.id === currentId)) {
    return currentId;
  }
  return choices[0]?.id ?? "";
}

/** What the activate button does with this choice. The API call is the same
 * either way (`adminActivate`); the label says which of the three it is. */
export function activateLabel(current: ShopPlanResponse | null, choiceId: string): string {
  if (current?.plan?.id === choiceId) {
    return "Renew plan";
  }
  return current?.active ? "Change plan" : "Activate plan";
}

/** The assigned plan's name, or what stands in for one: a business activated
 * the old way (a raw day count, before plans had names) has an expiry but no
 * plan; a business never activated has neither. */
export function assignedPlanName(current: ShopPlanResponse): string {
  if (current.plan !== null) {
    return current.plan.name;
  }
  return current.expiresAt === null ? "None yet" : "No named plan";
}

/** Active / Expired / Not active (never activated). Printing is paused for
 * the last two alike; the wording just says which. */
export function planStateLabel(current: ShopPlanResponse): string {
  if (current.active) {
    return "Active";
  }
  return current.expiresAt === null ? "Not active" : "Expired";
}

/** True when a failure is the API refusing to delete a plan that businesses
 * are still assigned to (409). Duck-typed on `status`, like `error-copy`. */
export function isPlanInUse(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { status?: unknown }).status === 409
  );
}

export const PLAN_IN_USE_ADVICE =
  "Archive the plan instead: the businesses already on it keep it until you change or cancel their plan, and it can no longer be chosen for anyone else.";
