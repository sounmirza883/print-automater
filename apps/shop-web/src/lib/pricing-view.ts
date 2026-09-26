import type {
  PricingRule,
  PricingRuleInput,
  Product,
  ProductInput,
} from "@print-automated/api-client";
import { Finishing, PaperSize, PaperType } from "@print-automated/types";
import { minorToInput, parseMoneyToMinor } from "@/lib/format";
import { basisPointsToPercent, optionalText, percentToBasisPoints } from "@/lib/form-values";

export const SURCHARGE_PAPER_SIZES = Object.values(PaperSize);
export const SURCHARGE_PAPER_TYPES = Object.values(PaperType);
export const CHARGE_FINISHINGS = Object.values(Finishing).filter((value) => value !== "NONE");

export interface PricingForm {
  currency: string;
  pricePerPage: string;
  colorSurcharge: string;
  minimumCharge: string;
  taxPercent: string;
  sizeSurcharges: Record<string, string>;
  typeSurcharges: Record<string, string>;
  finishingCharges: Record<string, string>;
  otherCharges: Array<{ key: string; label: string; amount: string }>;
}

const mapToText = (map: Record<string, number> | null, currency: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(map ?? {}).map(([key, value]) => [key, minorToInput(value, currency)]),
  );

let chargeSeq = 0;
export const newCharge = (): PricingForm["otherCharges"][number] => ({
  key: `c${++chargeSeq}`,
  label: "",
  amount: "",
});

export function ruleToForm(rule: PricingRule): PricingForm {
  return {
    currency: rule.currency,
    pricePerPage: minorToInput(rule.pricePerPageMinor, rule.currency),
    colorSurcharge: minorToInput(rule.colorSurchargePerPageMinor, rule.currency),
    minimumCharge: minorToInput(rule.minimumChargeMinor, rule.currency),
    taxPercent: basisPointsToPercent(rule.taxRateBasisPoints),
    sizeSurcharges: mapToText(rule.paperSizeSurchargePerPageMinor, rule.currency),
    typeSurcharges: mapToText(rule.paperTypeSurchargePerPageMinor, rule.currency),
    finishingCharges: mapToText(rule.finishingChargeMinor, rule.currency),
    otherCharges: rule.otherCharges.map((charge) => ({
      key: `c${++chargeSeq}`,
      label: charge.label,
      amount: minorToInput(charge.amountMinor, rule.currency),
    })),
  };
}

export function emptyPricingForm(currency = "PKR"): PricingForm {
  return {
    currency,
    pricePerPage: "",
    colorSurcharge: "0",
    minimumCharge: "0",
    taxPercent: "",
    sizeSurcharges: {},
    typeSurcharges: {},
    finishingCharges: {},
    otherCharges: [],
  };
}

export type PricingCheck =
  { ok: true; input: PricingRuleInput } | { ok: false; errors: Record<string, string> };

function moneyMap(
  values: Record<string, string>,
  currency: string,
  label: string,
  errors: Record<string, string>,
): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [key, text] of Object.entries(values)) {
    if (text.trim() === "") continue;
    const parsed = parseMoneyToMinor(text, currency);
    if (parsed === null) {
      errors[`${label}.${key}`] = "Enter an amount like 1.25, or leave blank.";
    } else {
      out[key] = parsed;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Turns the pricing form into the API body, in integer minor units, and
 * says exactly which field is wrong. Blank surcharges are simply omitted.
 * "Other charges" may be negative (a discount), which the API allows. */
export function buildPricingInput(form: PricingForm): PricingCheck {
  const errors: Record<string, string> = {};
  const currency = form.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Use a 3-letter currency code.";
  const price = parseMoneyToMinor(form.pricePerPage, currency);
  if (price === null) errors.pricePerPage = "Enter the price per page, like 12.00.";
  const color = parseMoneyToMinor(form.colorSurcharge, currency);
  if (color === null) errors.colorSurcharge = "Enter an amount (0 for none).";
  const minimum = parseMoneyToMinor(form.minimumCharge, currency);
  if (minimum === null) errors.minimumCharge = "Enter an amount (0 for none).";
  const tax = percentToBasisPoints(form.taxPercent);
  if (tax === undefined)
    errors.taxPercent = "Enter a percentage from 0 to 100, up to two decimals.";
  const size = moneyMap(form.sizeSurcharges, currency, "size", errors);
  const type = moneyMap(form.typeSurcharges, currency, "type", errors);
  const finishing = moneyMap(form.finishingCharges, currency, "finishing", errors);
  const others: Array<{ label: string; amountMinor: number }> = [];
  for (const charge of form.otherCharges) {
    if (charge.label.trim() === "" && charge.amount.trim() === "") continue;
    const negative = charge.amount.trim().startsWith("-");
    const parsed = parseMoneyToMinor(
      negative ? charge.amount.trim().slice(1) : charge.amount,
      currency,
    );
    if (charge.label.trim() === "" || parsed === null) {
      errors[`other.${charge.key}`] =
        "Give the charge a name and an amount (a leading minus is a discount).";
    } else {
      others.push({ label: charge.label.trim(), amountMinor: negative ? -parsed : parsed });
    }
  }
  if (
    Object.keys(errors).length > 0 ||
    price === null ||
    color === null ||
    minimum === null ||
    tax === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    input: {
      currency,
      pricePerPageMinor: price,
      colorSurchargePerPageMinor: color,
      minimumChargeMinor: minimum,
      otherCharges: others,
      paperSizeSurchargePerPageMinor: size,
      paperTypeSurchargePerPageMinor: type,
      finishingChargeMinor: finishing,
      taxRateBasisPoints: tax ?? undefined,
    },
  };
}

export interface ProductForm {
  name: string;
  description: string;
  category: string;
  unit: string;
  taxPercent: string;
  needsColor: boolean;
  needsDuplex: boolean;
  needsA3: boolean;
  paperSize: string;
  paperType: string;
  available: boolean;
}

export function emptyProductForm(): ProductForm {
  return {
    name: "",
    description: "",
    category: "",
    unit: "",
    taxPercent: "",
    needsColor: false,
    needsDuplex: false,
    needsA3: false,
    paperSize: "",
    paperType: "",
    available: true,
  };
}

export function productToForm(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    unit: product.unit ?? "",
    taxPercent: basisPointsToPercent(product.taxRateBasisPoints),
    needsColor: product.printerRequirements?.color ?? false,
    needsDuplex: product.printerRequirements?.duplex ?? false,
    needsA3: product.printerRequirements?.a3 ?? false,
    paperSize: product.paperRequirements?.paperSize ?? "",
    paperType: product.paperRequirements?.paperType ?? "",
    available: product.available,
  };
}

export type ProductCheck =
  | { ok: true; input: ProductInput & { name: string } }
  | { ok: false; errors: Partial<Record<"name" | "taxPercent", string>> };

export function buildProductInput(form: ProductForm): ProductCheck {
  const errors: Partial<Record<"name" | "taxPercent", string>> = {};
  if (form.name.trim() === "") errors.name = "Enter a name.";
  const tax = percentToBasisPoints(form.taxPercent);
  if (tax === undefined)
    errors.taxPercent = "Enter a percentage from 0 to 100, up to two decimals.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const requiresAnything = form.needsColor || form.needsDuplex || form.needsA3;
  const paper = {
    ...(form.paperSize ? { paperSize: form.paperSize } : {}),
    ...(form.paperType ? { paperType: form.paperType } : {}),
  };
  return {
    ok: true,
    input: {
      name: form.name.trim(),
      description: optionalText(form.description),
      category: optionalText(form.category),
      unit: optionalText(form.unit),
      taxRateBasisPoints: tax ?? undefined,
      // The printer must be able to do what is ticked; A4 is assumed of every printer.
      printerRequirements: requiresAnything
        ? { color: form.needsColor, duplex: form.needsDuplex, a4: true, a3: form.needsA3 }
        : undefined,
      paperRequirements: Object.keys(paper).length > 0 ? paper : undefined,
      available: form.available,
    },
  };
}
