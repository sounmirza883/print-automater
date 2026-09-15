/** A single, already-final amount contributed to a quote's subtotal --
 * shown verbatim on the §22 review screen. `lineItems` always sums to
 * exactly `subtotalMinor` (asserted by this package's own tests); there
 * is no hidden math the customer can't see. */
export interface PricingLineItem {
  label: string;
  amountMinor: number;
}

/** All money in this package is integer minor units (paisa/cents) --
 * never floating point (§19's own requirement, and the plan's §4.1
 * Done-when: "no floating-point money"). */
export interface Quote {
  lineItems: PricingLineItem[];
  subtotalMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  currency: string;
}

/** A shop's own pricing, versioned per shop (persisted by Migration
 * 003, 4.2) -- this type is the pure-computation input, not the DB row
 * shape. Deliberately excludes a delivery fee: §19's formula lists one,
 * but delivery itself is an explicit MVP non-goal (§11) with nothing
 * anywhere in this codebase that could ever populate it yet -- adding
 * the field now would just be an unused knob pretending to be
 * finished. `otherCharges` is the formula's open-ended "+ other print
 * charges" term; a shop with no extras passes `[]`, not `undefined`. */
export interface PricingRule {
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges: PricingLineItem[];
  /** Applied to the raw subtotal (page price + color surcharge + other
   * charges), before the platform fee -- a job priced below this floor
   * gets a visible "Minimum order adjustment" line item making up the
   * difference, never a silent bump. */
  minimumChargeMinor: number;
}

export class InvalidPageSelectionError extends Error {}
export class InvalidQuoteInputError extends Error {}
