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
  /** Price for 365 days, in major units; blank = no annual option. */
  annualPrice: string;
  /** "Most popular" badge on the public pricing page. */
  highlighted: boolean;
  /** Custom pricing: no price is shown; the card says "Contact us". */
  contactOnly: boolean;
  /** Display order on the public page (low first). */
  sortOrder: string;
  /** featureId -> "true" | "false" | text; the plan's Compare-table cells. */
  values: Record<string, string>;
}

/** The limits `createPlanDefinitionSchema` enforces; the API re-checks them. */
export const MAX_PLAN_PRICE_MINOR = 100_000_000;
export const MAX_BILLING_PERIOD_DAYS = 3650;
export const MAX_SORT_ORDER = 1000;

/** PKR because it is the platform default a business starts with (see
 * `useCurrency`); 30 days because monthly is the common case. */
export const EMPTY_PLAN_FORM: PlanForm = {
  name: "",
  price: "",
  currency: "PKR",
  billingPeriodDays: "30",
  description: "",
  annualPrice: "",
  highlighted: false,
  contactOnly: false,
  sortOrder: "0",
  values: {},
};

export function planToForm(plan: PlanDefinitionResponse): PlanForm {
  return {
    name: plan.name,
    price: minorToInput(plan.priceMinor, plan.currency),
    currency: plan.currency,
    billingPeriodDays: String(plan.billingPeriodDays),
    description: plan.description ?? "",
    annualPrice:
      plan.annualPriceMinor === null ? "" : minorToInput(plan.annualPriceMinor, plan.currency),
    highlighted: plan.highlighted,
    contactOnly: plan.contactOnly,
    sortOrder: String(plan.sortOrder),
    values: { ...plan.values },
  };
}

/** Upper-cased and trimmed, the way the API's schema normalises it. */
export function normalizeCurrency(text: string): string {
  return text.trim().toUpperCase();
}

/** How a Compare-table cell is edited: ticked, a dash, or custom text ("10", "Unlimited"). */
export type ValueMode = "yes" | "no" | "text";

export const valueMode = (value: string): ValueMode =>
  value === "true" ? "yes" : value.trim() === "" || value === "false" ? "no" : "text";

export const modeToValue = (mode: ValueMode, text: string): string =>
  mode === "yes" ? "true" : mode === "no" ? "false" : text;

/** A dash is the absence of a value, so only ticks and text are sent. */
const sentValues = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value.trim() !== "" && value !== "false")
      .map(([featureId, value]) => [featureId, value.trim()]),
  );

const sortedEntries = (values: Record<string, string>): Array<[string, string]> =>
  Object.entries(values).sort(([a], [b]) => a.localeCompare(b));

export type PlanFormProblems = Partial<
  Record<"name" | "price" | "currency" | "billingPeriodDays" | "annualPrice" | "sortOrder", string>
>;

export type PlanFormCheck =
  { ok: true; input: CreatePlanDefinitionBody } | { ok: false; problems: PlanFormProblems };

/** Validates the way the API will (name required, a 3-letter currency, a price
 * with no more decimals than that currency has, 1-3650 days, a display order from
 * 0 to 1000) and builds the create body. A contact-only plan needs no price (0 is
 * sent). Lengths are capped by the inputs themselves. */
export function checkPlanForm(form: PlanForm): PlanFormCheck {
  const problems: PlanFormProblems = {};
  const name = form.name.trim();
  if (name === "") problems.name = "Enter a plan name.";

  const currency = normalizeCurrency(form.currency);
  const currencyOk = minorUnitDigits(currency) !== null;
  if (!currencyOk) problems.currency = "Enter a 3-letter currency code, such as PKR.";

  const digits = (currencyOk ? minorUnitDigits(currency) : null) ?? 2;
  const amountHint =
    digits === 0
      ? "Enter a whole amount, such as 2500."
      : `Enter an amount such as 2500 or 2500.${"0".repeat(digits)}.`;
  const tooMuch = `The most a plan can cost is ${formatMoney(
    MAX_PLAN_PRICE_MINOR,
    currencyOk ? currency : "PKR",
  )}.`;

  // A contact-only plan may leave the price blank (0 is sent); a price already typed is
  // still validated and kept, so toggling "Contact us" never silently zeroes it.
  let priceMinor: number | null = 0;
  if (!(form.contactOnly && form.price.trim() === "")) {
    priceMinor = parseMoneyToMinor(form.price, currency);
    if (priceMinor === null) {
      problems.price = amountHint;
    } else if (priceMinor > MAX_PLAN_PRICE_MINOR) {
      problems.price = tooMuch;
    }
  }

  let annualPriceMinor: number | undefined;
  if (form.annualPrice.trim() !== "") {
    const parsed = parseMoneyToMinor(form.annualPrice, currency);
    if (parsed === null) {
      problems.annualPrice = amountHint;
    } else if (parsed > MAX_PLAN_PRICE_MINOR) {
      problems.annualPrice = tooMuch;
    } else {
      annualPriceMinor = parsed;
    }
  }

  const billingPeriodDays = parseWholeNumber(form.billingPeriodDays, {
    min: 1,
    max: MAX_BILLING_PERIOD_DAYS,
  });
  if (billingPeriodDays === undefined) {
    problems.billingPeriodDays = `Enter a whole number of days from 1 to ${MAX_BILLING_PERIOD_DAYS}.`;
  }

  const sortOrder = parseWholeNumber(form.sortOrder, { min: 0, max: MAX_SORT_ORDER });
  if (sortOrder === undefined) {
    problems.sortOrder = `Enter a whole number from 0 to ${MAX_SORT_ORDER}.`;
  }

  if (
    Object.keys(problems).length > 0 ||
    priceMinor === null ||
    billingPeriodDays === undefined ||
    sortOrder === undefined
  ) {
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
      ...(annualPriceMinor !== undefined && { annualPriceMinor }),
      highlighted: form.highlighted,
      contactOnly: form.contactOnly,
      sortOrder,
      values: sentValues(form.values),
    },
  };
}

/** The smallest `PATCH /admin/plans/:id` body: only what differs from `plan`.
 * Clearing the description sends `null` -- the server schema (and
 * `UpdatePlanDefinitionBody`) distinguish `null` ("clear this field") from
 * `undefined`/omitted ("leave it alone"); a plain `""` would be stored as a
 * literal empty string, not actually clear the field server-side. The annual price
 * works the same way (`null` removes the option), and `values` is sent whole (it
 * replaces the plan's cells) but only when it changed. */
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
  if ((input.annualPriceMinor ?? null) !== plan.annualPriceMinor) {
    body.annualPriceMinor = input.annualPriceMinor ?? null;
  }
  if (input.highlighted !== undefined && input.highlighted !== plan.highlighted) {
    body.highlighted = input.highlighted;
  }
  if (input.contactOnly !== undefined && input.contactOnly !== plan.contactOnly) {
    body.contactOnly = input.contactOnly;
  }
  if (input.sortOrder !== undefined && input.sortOrder !== plan.sortOrder) {
    body.sortOrder = input.sortOrder;
  }
  const values = input.values ?? {};
  if (
    JSON.stringify(sortedEntries(values)) !== JSON.stringify(sortedEntries(sentValues(plan.values)))
  ) {
    body.values = values;
  }
  return body;
}
