import { ColorMode, Finishing, type PrintConfiguration } from "@print-automated/types";
import { resolvePageCount } from "./resolve-page-count.js";
import {
  InvalidQuoteInputError,
  type PricingLineItem,
  type PricingRule,
  type Quote,
} from "./types.js";

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
 * tests assert that as an invariant, not an oversight. 17.2 leaves this
 * exactly as-is: duplex changes how much physical paper a shop
 * consumes, but nothing in §14/§19's own pricing model prices physical
 * paper consumption directly (only per-logical-page price, color, and
 * now paper size/type -- both already independent of duplex), so there
 * is still no defensible reason to charge for it here. */
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

  const lineItems: PricingLineItem[] = [
    { label: "Page price", amountMinor: pricingRule.pricePerPageMinor * units },
    ...(config.color === ColorMode.COLOR
      ? [{ label: "Color surcharge", amountMinor: pricingRule.colorSurchargePerPageMinor * units }]
      : []),
    ...paperSizeLineItems(config, pricingRule, units),
    ...paperTypeLineItems(config, pricingRule, units),
    ...finishingLineItems(config, pricingRule),
    ...pricingRule.otherCharges,
  ];

  const rawSubtotalMinor = lineItems.reduce((sum, item) => sum + item.amountMinor, 0);

  let subtotalMinor = rawSubtotalMinor;
  if (rawSubtotalMinor < pricingRule.minimumChargeMinor) {
    const adjustment = pricingRule.minimumChargeMinor - rawSubtotalMinor;
    lineItems.push({ label: MINIMUM_ORDER_ADJUSTMENT_LABEL, amountMinor: adjustment });
    subtotalMinor = pricingRule.minimumChargeMinor;
  }

  // 17.2/§14: tax is computed on the post-minimum-charge subtotal, in
  // basis points -- e.g. 1700 = 17%. Deliberately NOT one of
  // `lineItems` (see Quote's own comment); a PricingRule with no
  // `taxRateBasisPoints` set produces `taxMinor: 0`, so every
  // pre-17.2 caller's total is completely unaffected.
  const taxMinor = pricingRule.taxRateBasisPoints
    ? Math.round((subtotalMinor * pricingRule.taxRateBasisPoints) / 10_000)
    : 0;

  return {
    lineItems,
    subtotalMinor,
    taxMinor,
    platformFeeMinor,
    totalMinor: subtotalMinor + taxMinor + platformFeeMinor,
    currency: pricingRule.currency,
  };
}

/** §14/17.2: A3-vs-A4-style surcharges -- applied per unit (page x
 * copy), the same basis the page price and color surcharge already
 * use. A size with no entry in the map (or the map itself omitted)
 * contributes nothing -- "no surcharge configured" is silent, not an
 * error, the same "absent means today's behaviour" contract every
 * other 17.2 addition follows. */
function paperSizeLineItems(
  config: PrintConfiguration,
  pricingRule: PricingRule,
  units: number,
): PricingLineItem[] {
  const perPage = pricingRule.paperSizeSurchargePerPageMinor?.[config.paperSize];
  if (!perPage) {
    return [];
  }
  return [{ label: `Paper size surcharge (${config.paperSize})`, amountMinor: perPage * units }];
}

/** Mirrors paperSizeLineItems exactly, keyed by `PaperType` instead --
 * `config.paperType` is itself optional (15.1: an absent value means
 * "standard paper"), so this contributes nothing unless a type was
 * actually chosen AND that type has a configured surcharge. */
function paperTypeLineItems(
  config: PrintConfiguration,
  pricingRule: PricingRule,
  units: number,
): PricingLineItem[] {
  if (!config.paperType) {
    return [];
  }
  const perPage = pricingRule.paperTypeSurchargePerPageMinor?.[config.paperType];
  if (!perPage) {
    return [];
  }
  return [{ label: `Paper type surcharge (${config.paperType})`, amountMinor: perPage * units }];
}

/** §14/17.2: finishing is charged FLAT per selected option, once per
 * job -- never multiplied by `units` (see PricingRule's own comment
 * for why: a bound document is bound once, not once per page).
 * `Finishing.NONE` is excluded even if a caller includes it in
 * `config.finishing` -- it explicitly means "no finishing" (its own
 * enum doc comment), so it must never itself carry a charge. Multiple
 * finishing options each contribute their own line item, in the order
 * the caller listed them. */
function finishingLineItems(
  config: PrintConfiguration,
  pricingRule: PricingRule,
): PricingLineItem[] {
  return (config.finishing ?? [])
    .filter((option) => option !== Finishing.NONE)
    .map((option) => {
      const flat = pricingRule.finishingChargeMinor?.[option];
      return flat ? { label: `Finishing: ${option}`, amountMinor: flat } : null;
    })
    .filter((item): item is PricingLineItem => item !== null);
}
