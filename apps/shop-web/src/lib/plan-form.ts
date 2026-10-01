import type {
  CreatePlanDefinitionBody,
  UpdatePlanDefinitionBody,
} from "@print-automated/api-client";
import type { PlanDefinitionResponse } from "@print-automated/types";
import { formatMoney, minorToInput, minorUnitDigits, parseMoneyToMinor } from "@/lib/format";
import { optionalText, parseWholeNumber } from "@/lib/form-values";

/** Plan management: what a platform admin types to define a plan. The price is
 * typed in major units ("2500" or "2500.00") and sent as integer minor units in
 * the plan's own currency, through the same `parseMoneyToMinor`/`minorToInput`
 * pair every other amount field uses (reprint cost, delivery fee, supplier
 * prices) -- so PKR 2500 is sent as 250000 paisa, JPY 2500 as 2500. */
export interface PlanForm {
  name: string;
  price: string;
  currency: string;
  billingPeriodDays: string;
  description: string;
}

/** The limits `createPlanDefinitionSchema` enforces; the API re-checks them. */
export const MAX_PLAN_PRICE_MINOR = 100_000_000;
export const MAX_BILLING_PERIOD_DAYS = 3650;

/** PKR because it is the platform default a business starts with (see
 * `useCurrency`); 30 days because monthly is the common case. */
export const EMPTY_PLAN_FORM: PlanForm = {
  name: "",
  price: "",
  currency: "PKR",
  billingPeriodDays: "30",
  description: "",
};

export function planToForm(plan: PlanDefinitionResponse): PlanForm {
  return {
    name: plan.name,
    price: minorToInput(plan.priceMinor, plan.currency),
    currency: plan.currency,
    billingPeriodDays: String(plan.billingPeriodDays),
    description: plan.description ?? "",
  };
}

/** Upper-cased and trimmed, the way the API's schema normalises it. */
export function normalizeCurrency(text: string): string {
  return text.trim().toUpperCase();
}

export type PlanFormProblems = Partial<
  Record<"name" | "price" | "currency" | "billingPeriodDays", string>
>;

export type PlanFormCheck =
  { ok: true; input: CreatePlanDefinitionBody } | { ok: false; problems: PlanFormProblems };

/** Validates the way the API will (name required, a 3-letter currency, a price
 * with no more decimals than that currency has, 1-3650 days) and builds the
 * create body. Lengths are capped by the inputs themselves. */
export function checkPlanForm(form: PlanForm): PlanFormCheck {
  const problems: PlanFormProblems = {};
  const name = form.name.trim();
  if (name === "") problems.name = "Enter a plan name.";

  const currency = normalizeCurrency(form.currency);
  const currencyOk = minorUnitDigits(currency) !== null;
  if (!currencyOk) problems.currency = "Enter a 3-letter currency code, such as PKR.";

  const priceMinor = parseMoneyToMinor(form.price, currency);
  if (priceMinor === null) {
    const digits = (currencyOk ? minorUnitDigits(currency) : null) ?? 2;
    problems.price =
      digits === 0
        ? "Enter a whole amount, such as 2500."
        : `Enter an amount such as 2500 or 2500.${"0".repeat(digits)}.`;
  } else if (priceMinor > MAX_PLAN_PRICE_MINOR) {
    problems.price = `The most a plan can cost is ${formatMoney(
      MAX_PLAN_PRICE_MINOR,
      currencyOk ? currency : "PKR",
    )}.`;
  }

  const billingPeriodDays = parseWholeNumber(form.billingPeriodDays, {
    min: 1,
    max: MAX_BILLING_PERIOD_DAYS,
  });
  if (billingPeriodDays === undefined) {
    problems.billingPeriodDays = `Enter a whole number of days from 1 to ${MAX_BILLING_PERIOD_DAYS}.`;
  }

  if (Object.keys(problems).length > 0 || priceMinor === null || billingPeriodDays === undefined) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    input: {
      name,
      priceMinor,
      currency,
      billingPeriodDays,
      description: optionalText(form.description),
    },
  };
}

/** The smallest `PATCH /admin/plans/:id` body: only what differs from `plan`.
 * Clearing the description sends `null` -- the server schema (and
 * `UpdatePlanDefinitionBody`) distinguish `null` ("clear this field") from
 * `undefined`/omitted ("leave it alone"); a plain `""` would be stored as a
 * literal empty string, not actually clear the field server-side. */
export function toUpdatePlanInput(
  plan: PlanDefinitionResponse,
  input: CreatePlanDefinitionBody,
): UpdatePlanDefinitionBody {
  const body: UpdatePlanDefinitionBody = {};
  if (input.name !== plan.name) body.name = input.name;
  if (input.priceMinor !== plan.priceMinor) body.priceMinor = input.priceMinor;
  if (input.currency !== plan.currency) body.currency = input.currency;
  if (input.billingPeriodDays !== plan.billingPeriodDays) {
    body.billingPeriodDays = input.billingPeriodDays;
  }
  const description = input.description ?? "";
  if (description !== (plan.description ?? "")) {
    body.description = description === "" ? null : description;
  }
  return body;
}
