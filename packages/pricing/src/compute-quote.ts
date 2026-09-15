import { ColorMode, type PrintConfiguration } from "@print-automated/types";
import { resolvePageCount } from "./resolve-page-count.js";
import { InvalidQuoteInputError, type PricingRule, type Quote } from "./types.js";

const MINIMUM_ORDER_ADJUSTMENT_LABEL = "Minimum order adjustment";

/** §19: "The backend is the authoritative pricing engine. Never accept
 * a client-calculated total as authoritative." This is that engine --
 * pure, zero I/O, called server-side only (4.4's quote/order endpoints
 * recompute from scratch on every request; a client-supplied total is
 * never read).
 *
 * `documentPageCount` is the uploaded document's real page count (from
 * 2.7's processing result) -- needed to resolve `config.pages` when its
 * mode is `"all"` (see resolvePageCount.ts). `platformFeeMinor` is a
 * platform-wide fee, not part of any shop's own `PricingRule`, so it's
 * its own parameter rather than a field a shop could set.
 *
 * Sides/orientation deliberately have no effect on price: §19's formula
 * names page price, color surcharge, other charges, and platform fee --
 * nothing about duplex. "Pages" is the logical page count a customer
 * is printing, not physical sheets consumed, so single vs double-sided
 * charges the same amount for the same content -- this package's own
 * tests assert that as an invariant, not an oversight. */
export function computeQuote(
  config: PrintConfiguration,
  documentPageCount: number,
  pricingRule: PricingRule,
  platformFeeMinor: number,
): Quote {
  if (!Number.isInteger(config.copies) || config.copies < 1) {
    throw new InvalidQuoteInputError(`copies must be a positive integer, got ${config.copies}.`);
  }
  if (!Number.isInteger(platformFeeMinor) || platformFeeMinor < 0) {
    throw new InvalidQuoteInputError(
      `platformFeeMinor must be a non-negative integer, got ${platformFeeMinor}.`,
    );
  }

  const pageCount = resolvePageCount(config.pages, documentPageCount);
  const units = pageCount * config.copies;

  const lineItems = [
    { label: "Page price", amountMinor: pricingRule.pricePerPageMinor * units },
    ...(config.color === ColorMode.COLOR
      ? [{ label: "Color surcharge", amountMinor: pricingRule.colorSurchargePerPageMinor * units }]
      : []),
    ...pricingRule.otherCharges,
  ];

  const rawSubtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);

  let subtotalMinor = rawSubtotalMinor;
  if (rawSubtotalMinor < pricingRule.minimumChargeMinor) {
    const adjustment = pricingRule.minimumChargeMinor - rawSubtotalMinor;
    lineItems.push({ label: MINIMUM_ORDER_ADJUSTMENT_LABEL, amountMinor: adjustment });
    subtotalMinor = pricingRule.minimumChargeMinor;
  }

  return {
    lineItems,
    subtotalMinor,
    platformFeeMinor,
    totalMinor: subtotalMinor + platformFeeMinor,
    currency: pricingRule.currency,
  };
}
