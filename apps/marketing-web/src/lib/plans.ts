/** The plans an admin manages in the shop dashboard (`/admin/plans`), as the
 * public pricing section shows them. Read from the API's public `GET /v1/plans`
 * -- this site owns no plan data of its own. Pure helpers plus one fetch, so
 * the formatting is unit-tested. */

export type PublicPlan = {
  name: string;
  /** Integer minor units (paisa for PKR), the API's money convention. */
  priceMinor: number;
  /** ISO 4217, upper-case. Admins default it to PKR. */
  currency: string;
  /** How many days one activation covers. */
  billingPeriodDays: number;
  description: string | null;
};

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

function isPublicPlan(value: unknown): value is PublicPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.name === "string" &&
    typeof plan.priceMinor === "number" &&
    typeof plan.currency === "string" &&
    typeof plan.billingPeriodDays === "number" &&
    (plan.description === null || typeof plan.description === "string")
  );
}

/** How long a fetched plan list is reused before the next visitor triggers a
 * refresh: an admin's change shows on the site within about this long. */
export const PLANS_REVALIDATE_SECONDS = 60;

/** The live plans, cheapest first, or `null` when they could not be loaded
 * (API down, bad response). `null` -- not `[]` -- so the page can tell "could not
 * load" from "the admin has not created any yet" and never prints a fake price. */
export async function fetchPlans(apiBaseUrl: string): Promise<PublicPlan[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl}/v1/plans`, {
      headers: { Accept: "application/json" },
      next: { revalidate: PLANS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const items = (body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items) || !items.every(isPublicPlan)) return null;
    return items;
  } catch {
    return null;
  }
}
