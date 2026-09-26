import type { InventoryItem, InventoryItemInput } from "@print-automated/api-client";
import { InventoryMovementType, PaperSize, PaperType } from "@print-automated/types";
import { humanizeEnum, minorToInput, parseMoneyToMinor } from "@/lib/format";
import { nullableText, optionalText, parseWholeNumber } from "@/lib/form-values";

export const enumOptions = (values: Record<string, string>) =>
  Object.values(values).map((value) => ({ value, label: humanizeEnum(value) }));

export const PAPER_SIZE_OPTIONS = enumOptions(PaperSize);
export const PAPER_TYPE_OPTIONS = enumOptions(PaperType);

/** Movements a person may record by hand. CONSUMPTION is written by
 * printing itself, and TRANSFER has no second location to move to, so
 * neither is offered. */
export const MANUAL_MOVEMENT_TYPES = [
  InventoryMovementType.PURCHASE,
  InventoryMovementType.ADJUSTMENT,
  InventoryMovementType.RETURN,
  InventoryMovementType.CORRECTION,
] as const;

export type MovementCheck =
  | { ok: true; input: { type: string; quantityDelta: number; reason?: string } }
  | { ok: false; error: string };

/** Mirrors the API's own movement rules so the form explains a mistake
 * before sending it (the API re-checks, and adds INSUFFICIENT_STOCK /
 * STOCK_OVERFLOW, which depend on current stock). */
export function checkMovement(type: string, quantityText: string, reason: string): MovementCheck {
  const quantity = parseWholeNumber(quantityText, { min: -100_000_000, max: 100_000_000 });
  if (quantity === undefined || quantity === 0) {
    return { ok: false, error: "Enter a whole number that is not zero." };
  }
  if ((type === "PURCHASE" || type === "RETURN") && quantity < 0) {
    return { ok: false, error: "A purchase or return adds stock: enter a positive number." };
  }
  if ((type === "ADJUSTMENT" || type === "CORRECTION") && optionalText(reason) === undefined) {
    return { ok: false, error: "An adjustment or correction needs a reason." };
  }
  return {
    ok: true,
    input: { type, quantityDelta: quantity, reason: optionalText(reason) },
  };
}

export interface ItemForm {
  name: string;
  sku: string;
  paperSize: string;
  paperType: string;
  weightGsm: string;
  minQuantity: string;
  maxQuantity: string;
  location: string;
  unitCost: string;
  initialQuantity: string;
}

export function emptyItemForm(): ItemForm {
  return {
    name: "",
    sku: "",
    paperSize: "",
    paperType: "",
    weightGsm: "",
    minQuantity: "0",
    maxQuantity: "",
    location: "",
    unitCost: "",
    initialQuantity: "0",
  };
}

export function itemToForm(item: InventoryItem, currency: string): ItemForm {
  return {
    name: item.name,
    sku: item.sku ?? "",
    paperSize: item.paperSize ?? "",
    paperType: item.paperType ?? "",
    weightGsm: item.weightGsm === null ? "" : String(item.weightGsm),
    minQuantity: String(item.minQuantity),
    maxQuantity: item.maxQuantity === null ? "" : String(item.maxQuantity),
    location: item.location ?? "",
    unitCost: item.unitCostMinor === null ? "" : minorToInput(item.unitCostMinor, currency),
    initialQuantity: "0",
  };
}

export type ItemCheck =
  | { ok: true; create: InventoryItemInput; update: InventoryItemInput }
  | { ok: false; errors: Partial<Record<keyof ItemForm, string>> };

/** Validates the form and produces BOTH shapes: a create body (blank
 * fields left out) and an update body (blank fields cleared with null). */
export function buildItemInput(form: ItemForm, currency: string): ItemCheck {
  const errors: Partial<Record<keyof ItemForm, string>> = {};
  if (form.name.trim() === "") errors.name = "Enter a name.";
  const min = parseWholeNumber(form.minQuantity);
  if (min === undefined) errors.minQuantity = "Enter a whole number, 0 or more.";
  const max = form.maxQuantity.trim() === "" ? null : parseWholeNumber(form.maxQuantity);
  if (max === undefined) errors.maxQuantity = "Enter a whole number, or leave blank.";
  if (min !== undefined && typeof max === "number" && max < min) {
    errors.maxQuantity = "The maximum cannot be below the minimum.";
  }
  const gsm =
    form.weightGsm.trim() === "" ? null : parseWholeNumber(form.weightGsm, { min: 1, max: 5000 });
  if (gsm === undefined) errors.weightGsm = "Enter grams per square metre, 1 to 5000.";
  const cost = form.unitCost.trim() === "" ? null : parseMoneyToMinor(form.unitCost, currency);
  if (cost === null && form.unitCost.trim() !== "") errors.unitCost = "Enter an amount like 1.25.";
  const initial = parseWholeNumber(form.initialQuantity);
  if (initial === undefined) errors.initialQuantity = "Enter a whole number, 0 or more.";
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  const create: InventoryItemInput = {
    name: form.name.trim(),
    sku: optionalText(form.sku),
    paperSize: optionalText(form.paperSize),
    paperType: optionalText(form.paperType),
    weightGsm: gsm ?? undefined,
    minQuantity: min,
    maxQuantity: max ?? undefined,
    location: optionalText(form.location),
    unitCostMinor: cost ?? undefined,
    initialQuantity: initial,
  };
  const update: InventoryItemInput = {
    name: form.name.trim(),
    sku: nullableText(form.sku),
    paperSize: nullableText(form.paperSize),
    paperType: nullableText(form.paperType),
    weightGsm: gsm,
    minQuantity: min,
    maxQuantity: max,
    location: nullableText(form.location),
    unitCostMinor: cost,
  };
  return { ok: true, create, update };
}

export function stockTone(
  item: Pick<InventoryItem, "quantity" | "lowStock" | "active">,
): "danger" | "caution" | "good" | "neutral" {
  if (!item.active) return "neutral";
  if (item.quantity <= 0) return "danger";
  return item.lowStock ? "caution" : "good";
}

export function stockLabel(item: Pick<InventoryItem, "quantity" | "lowStock" | "active">): string {
  if (!item.active) return "Inactive";
  if (item.quantity <= 0) return "Out of stock";
  return item.lowStock ? "Low stock" : "In stock";
}
