import type { Finishing, PaperSize, PaperType } from "@print-automated/types";

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
 * Done-when: "no floating-point money").
 *
 * 17.2: `taxMinor` is deliberately NOT one of `lineItems` -- the same
 * "not part of the shop's own subtotal" reasoning `platformFeeMinor`
 * already established (it's a top-level charge on top of the shop's
 * revenue, not a shop-set line item), which is also what keeps this
 * package's own pre-existing invariant ("lineItems always sums to
 * exactly subtotalMinor") true without modification. `totalMinor` is
 * now `subtotalMinor + taxMinor + platformFeeMinor` -- for every
 * PricingRule that leaves `taxRateBasisPoints` unset, `taxMinor` is
 * always 0, so this is purely additive for every pre-17.2 caller. */
export interface Quote {
  lineItems: PricingLineItem[];
  subtotalMinor: number;
  taxMinor: number;
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
 * charges" term; a shop with no extras passes `[]`, not `undefined`.
 * It also already doubles as this rule's "discount" mechanism -- a
 * negative `amountMinor` other-charge line item (e.g. `{ label:
 * "Loyalty discount", amountMinor: -500 }`) reduces the subtotal
 * exactly the way a positive one increases it; no separate discount
 * field or code path was needed.
 *
 * 17.2/§14 additions, all optional so every PricingRule persisted
 * before this sub-phase -- including every row this package's own
 * pre-existing tests construct -- still prices identically:
 *   - `paperSizeSurchargePerPageMinor`/`paperTypeSurchargePerPageMinor`
 *     are keyed by the exact closed enums PrintConfiguration itself
 *     uses (PaperSize/PaperType, 15.1/§64) rather than another
 *     freeform `otherCharges`-style entry -- these are a defined,
 *     closed set a shop picks from, not an arbitrary label a shop
 *     types in, so real typed fields (checked structurally by Zod at
 *     the API boundary, 17.3) are the more honest shape. A size/type
 *     with no entry in the map (or the map itself omitted) means "no
 *     surcharge," the same "absent means today's behaviour" contract
 *     `otherCharges: []` already has. Applied per unit (page x copy),
 *     the same basis `pricePerPageMinor`/`colorSurchargePerPageMinor`
 *     already use -- larger/pricier stock costs proportionally more
 *     the more of it a job consumes, not a flat per-job amount.
 *   - `finishingChargeMinor` is keyed by `Finishing` the same way, but
 *     applied FLAT per selected option, once per job, not per unit --
 *     a bound document is bound once regardless of its page count, the
 *     same physical reasoning that makes stapling/binding/lamination
 *     genuinely different from a per-page cost.
 *   - `taxRateBasisPoints` is basis points (1/100 of a percent -- 1700
 *     means 17%), matching this schema's existing "never a float
 *     percentage" convention. Applied to the subtotal AFTER the
 *     minimum-charge adjustment below (a job priced up to the floor is
 *     taxed on what it actually charges, not on some smaller raw
 *     amount), producing `Quote.taxMinor` -- never re-derived once an
 *     order snapshots its quote (§82: this is still a pure function,
 *     called once at quote/order-creation time, same as everything
 *     else here). */
// 17.2 judgment call: §17/18's queue-priority surcharge (NORMAL/HIGH/
// URGENT) is deliberately NOT modeled here. Phase 18 hasn't landed --
// there is no `priority` field on PrintConfiguration, Order, or
// anywhere else this package could read one from yet. Adding a
// `prioritySurchargeMinor` map now, wired to nothing, would be an
// unused knob pretending to be finished (the same reasoning
// PricingRule's own comment already gives for excluding delivery fees)
// -- Phase 18 is the right place to extend both PrintConfiguration and
// this rule together, once a real `priority` value exists to price.
export interface PricingRule {
  currency: string;
  pricePerPageMinor: number;
  colorSurchargePerPageMinor: number;
  otherCharges: PricingLineItem[];
  /** Applied to the raw subtotal (page price + color surcharge + paper
   * size/type surcharges + finishing charges + other charges), before
   * tax and the platform fee -- a job priced below this floor gets a
   * visible "Minimum order adjustment" line item making up the
   * difference, never a silent bump. */
  minimumChargeMinor: number;
  paperSizeSurchargePerPageMinor?: Partial<Record<PaperSize, number>>;
  paperTypeSurchargePerPageMinor?: Partial<Record<PaperType, number>>;
  finishingChargeMinor?: Partial<Record<Finishing, number>>;
  taxRateBasisPoints?: number;
}

export class InvalidPageSelectionError extends Error {}
export class InvalidQuoteInputError extends Error {}
