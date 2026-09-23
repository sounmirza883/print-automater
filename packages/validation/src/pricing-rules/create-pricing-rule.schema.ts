import { z } from "zod";
import { Finishing, PaperSize, PaperType } from "@print-automated/types";

const otherChargeSchema = z.object({
  label: z.string().min(1).max(200),
  // Deliberately a plain signed integer, not `.min(0)` -- 17.2's own
  // discount mechanism is a negative-amount otherCharges entry (see
  // packages/pricing's PricingRule doc comment); rejecting negative
  // values here would make that mechanism unreachable through this API.
  amountMinor: z.number().int(),
});

/** §14/17.2's own typed surcharge maps, keyed by the exact closed
 * enums PrintConfiguration itself uses. Unlike `otherCharges`, these
 * values ARE constrained non-negative -- a shop can already discount
 * via `otherCharges`' own negative-amount convention, so a "negative
 * surcharge" here would just be a second, more confusing way to
 * express the same thing. */
function surchargeMapSchema<T extends [string, ...string[]]>(values: T) {
  return z.record(z.enum(values), z.number().int().min(0)).optional();
}

/** §4.2/17.3's own "create a new version" action -- `shopId` names the
 * shop; `version` is deliberately NOT a client-supplied field (the
 * service always computes current-max + 1, the same "never trust the
 * client with something the server can derive" reasoning §19 already
 * applies to pricing totals). */
export const createPricingRuleSchema = z.object({
  shopId: z.string().uuid(),
  currency: z.string().length(3),
  pricePerPageMinor: z.number().int().min(0),
  colorSurchargePerPageMinor: z.number().int().min(0),
  otherCharges: z.array(otherChargeSchema).default([]),
  minimumChargeMinor: z.number().int().min(0),
  paperSizeSurchargePerPageMinor: surchargeMapSchema(
    Object.values(PaperSize) as [string, ...string[]],
  ),
  paperTypeSurchargePerPageMinor: surchargeMapSchema(
    Object.values(PaperType) as [string, ...string[]],
  ),
  finishingChargeMinor: surchargeMapSchema(Object.values(Finishing) as [string, ...string[]]),
  taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
});

export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;
