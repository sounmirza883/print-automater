export type BillingCycle = "monthly" | "annual";

/** Annual billing is priced as this many months (2 months free). */
export const ANNUAL_MONTHS_CHARGED = 10;

/** Effective per-month price (whole currency units) for the given cycle. */
export function monthlyPrice(monthly: number, cycle: BillingCycle): number {
  if (cycle === "monthly") return monthly;
  return Math.round((monthly * ANNUAL_MONTHS_CHARGED) / 12);
}

/** Total billed per year on the annual cycle. */
export function annualTotal(monthly: number): number {
  return monthly * ANNUAL_MONTHS_CHARGED;
}

/** Amount saved per year on annual billing versus 12 monthly payments. */
export function annualSavings(monthly: number): number {
  return monthly * 12 - annualTotal(monthly);
}
