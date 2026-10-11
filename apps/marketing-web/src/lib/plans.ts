/** The plans an admin manages in the shop dashboard (`/admin/plans`), as the
 * public pricing section shows them. Read from the API's public `GET /v1/plans`
 * -- this site owns no plan data of its own. Pure helpers plus one fetch, so
 * the formatting and the card/table rules are unit-tested. */

export type PublicPlan = {
  name: string;
  description: string | null;
  /** Integer minor units (paisa for PKR), the API's money convention. Monthly price. */
  priceMinor: number;
  /** ISO 4217, upper-case. Admins default it to PKR. */
  currency: string;
  /** How many days one activation covers. */
  billingPeriodDays: number;
  /** Price for a whole year (minor units); null = no annual option. */
  annualPriceMinor: number | null;
  /** "Most popular" badge and emphasised card. */
  highlighted: boolean;
  /** Custom pricing: the card says "Custom pricing" and offers "Contact us". */
  contactOnly: boolean;
};

/** One row of the Compare plans table. */
export type PublicFeature = {
  section: string;
  label: string;
  /** Also a bullet on each plan's card. */
  showOnCard: boolean;
  /** Card bullet template, e.g. "{value} printers"; null = the label. */
  cardText: string | null;
  /** Keyed by plan name; "true" = tick, "false" or a missing key = dash, else the text. */
  values: Record<string, string>;
};

export type PlansPayload = { plans: PublicPlan[]; features: PublicFeature[] };

export type BillingCycle = "monthly" | "annual";

// A fixed table, not `Intl`: Intl's currency digits differ by engine (Chromium says
// PKR has 0, Node says 2) and a wrong answer shows a price off by a factor of 100.
// The API stores PKR as paisa (x100), so the table is the contract.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

function minorUnitDigits(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  return THREE_DECIMAL.has(currency) ? 3 : 2;
}

/** `250000, "PKR"` -> "PKR 2,500"; `250050, "PKR"` -> "PKR 2,500.50". Whole
 * amounts drop the empty decimals (a pricing card reads "PKR 2,500", not
 * "PKR 2,500.00"). */
export function formatPlanPrice(priceMinor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const major = priceMinor / 10 ** digits;
  const text = new Intl.NumberFormat("en", {
    minimumFractionDigits: Number.isInteger(major) ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(major);
  return `${currency} ${text}`;
}

/** The unit after the price: 30 -> "month", 365 -> "year", 7 -> "week", else "45 days". */
export function periodUnit(days: number): string {
  if (days === 30) return "month";
  if (days === 365) return "year";
  if (days === 7) return "week";
  return days === 1 ? "day" : `${days} days`;
}

/** The line under the price: "Billed monthly.", "Billed yearly.", "Billed every 45 days." */
export function billedNote(days: number): string {
  if (days === 30) return "Billed monthly.";
  if (days === 365) return "Billed yearly.";
  if (days === 7) return "Billed weekly.";
  return days === 1 ? "Billed daily." : `Billed every ${days} days.`;
}

/** What a year of monthly payments would cost: shown struck out next to the annual
 * price. Calculated, never stored, so it cannot drift from the monthly price. */
export const monthlyYearTotal = (plan: PublicPlan): number => plan.priceMinor * 12;

/** How much the annual price saves over twelve monthly payments; 0 when there is no
 * annual price or it is not actually cheaper (never a negative or fake saving). */
export function annualSaving(plan: PublicPlan): number {
  if (plan.annualPriceMinor === null) return 0;
  return Math.max(0, monthlyYearTotal(plan) - plan.annualPriceMinor);
}

/** The headline price for a cycle. A contact-only plan never prints a number (its
 * `priceMinor` is a meaningless 0); the annual view falls back to the monthly price
 * for a plan with no annual option. */
export function priceLabel(plan: PublicPlan, cycle: BillingCycle): string {
  if (plan.contactOnly) return "Custom pricing";
  const minor =
    cycle === "annual" && plan.annualPriceMinor !== null ? plan.annualPriceMinor : plan.priceMinor;
  return formatPlanPrice(minor, plan.currency);
}

/** The bullets on a plan's card: rows marked "on card" where this plan has a tick or a
 * value. A dash or a missing value is skipped. Text uses the row's template when it has
 * a `{value}` slot ("{value} printers" -> "10 printers"), else "label: value". */
export function cardBullets(plan: PublicPlan, features: readonly PublicFeature[]): string[] {
  const bullets: string[] = [];
  for (const feature of features) {
    const value = feature.values[plan.name];
    if (!feature.showOnCard || value === undefined || value === "false") continue;
    if (value === "true") {
      bullets.push(feature.cardText ?? feature.label);
    } else if (feature.cardText?.includes("{value}")) {
      bullets.push(feature.cardText.replace("{value}", value));
    } else {
      bullets.push(`${feature.label}: ${value}`);
    }
  }
  return bullets;
}

/** Table rows grouped under their section heading, in order of first appearance. */
export function groupFeatures(
  features: readonly PublicFeature[],
): Array<{ section: string; rows: PublicFeature[] }> {
  const groups: Array<{ section: string; rows: PublicFeature[] }> = [];
  for (const feature of features) {
    const group = groups.find((g) => g.section === feature.section);
    if (group) group.rows.push(feature);
    else groups.push({ section: feature.section, rows: [feature] });
  }
  return groups;
}

export type Cell = { kind: "yes" } | { kind: "no" } | { kind: "text"; text: string };

export function cellKind(value: string | undefined): Cell {
  if (value === "true") return { kind: "yes" };
  if (value === undefined || value === "false" || value.trim() === "") return { kind: "no" };
  return { kind: "text", text: value };
}

function isPublicPlan(value: unknown): value is PublicPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.name === "string" &&
    typeof plan.priceMinor === "number" &&
    typeof plan.currency === "string" &&
    typeof plan.billingPeriodDays === "number" &&
    (plan.description === null || typeof plan.description === "string") &&
    (plan.annualPriceMinor === null || typeof plan.annualPriceMinor === "number") &&
    typeof plan.highlighted === "boolean" &&
    typeof plan.contactOnly === "boolean"
  );
}

function isPublicFeature(value: unknown): value is PublicFeature {
  if (typeof value !== "object" || value === null) return false;
  const feature = value as Record<string, unknown>;
  const values = feature.values;
  return (
    typeof feature.section === "string" &&
    typeof feature.label === "string" &&
    typeof feature.showOnCard === "boolean" &&
    (feature.cardText === null || typeof feature.cardText === "string") &&
    typeof values === "object" &&
    values !== null &&
    Object.values(values).every((v) => typeof v === "string")
  );
}

/** How long a fetched plan list is reused before the next visitor triggers a
 * refresh: an admin's change shows on the site within about this long. */
export const PLANS_REVALIDATE_SECONDS = 60;

/** The live plans (in the admin's display order) and Compare-table rows, or `null`
 * when they could not be loaded (API down, bad response). `null` -- not empty lists --
 * so the page can tell "could not load" from "the admin has not created any yet" and
 * never prints a fake price. */
export async function fetchPlans(apiBaseUrl: string): Promise<PlansPayload | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/v1/plans`, {
      headers: { Accept: "application/json" },
      next: { revalidate: PLANS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown; features?: unknown } | null;
    const items = body?.items;
    const features = body?.features;
    if (!Array.isArray(items) || !items.every(isPublicPlan)) return null;
    if (!Array.isArray(features) || !features.every(isPublicFeature)) return null;
    return { plans: items, features };
  } catch {
    return null;
  }
}
