import type { PurchaseOrder } from "@print-automated/api-client";
import { parseMoneyToMinor } from "@/lib/format";
import { parseWholeNumber } from "@/lib/form-values";
import type { Tone } from "@/lib/job-status";

export const PO_STATUSES = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"] as const;
export const PO_PAYMENT_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;

export function poStatusTone(status: string): Tone {
  switch (status) {
    case "ORDERED":
      return "accent";
    case "RECEIVED":
      return "good";
    case "CANCELLED":
      return "neutral";
    default:
      return "caution";
  }
}

export interface PoActions {
  place: boolean;
  receive: boolean;
  cancel: boolean;
  editDetails: boolean;
  setPayment: boolean;
}

/** What may be done to a purchase order in its state. The API's
 * PURCHASE_ORDER_INVALID_STATE is the authority; this only decides which
 * buttons to show. Receiving is offered only once ordered, and a received
 * or cancelled order is closed except for recording payment. */
export function availablePoActions(status: string): PoActions {
  return {
    place: status === "DRAFT",
    receive: status === "ORDERED",
    cancel: status === "DRAFT" || status === "ORDERED",
    editDetails: status === "DRAFT" || status === "ORDERED",
    setPayment: status !== "CANCELLED",
  };
}

export interface LineForm {
  key: string;
  inventoryItemId: string;
  quantity: string;
  unitCost: string;
}

export type CreateCheck =
  | {
      ok: true;
      lines: Array<{ inventoryItemId: string; quantity: number; unitCostMinor?: number }>;
    }
  | { ok: false; error: string };

/** Validates the create form's lines the way the API will (each item once,
 * whole positive quantities, costs in the business currency), so the
 * mistake is explained before the request. */
export function checkPoLines(lines: readonly LineForm[], currency: string): CreateCheck {
  if (lines.length === 0) {
    return { ok: false, error: "Add at least one line." };
  }
  const seen = new Set<string>();
  const out: Array<{ inventoryItemId: string; quantity: number; unitCostMinor?: number }> = [];
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`;
    if (line.inventoryItemId === "") {
      return { ok: false, error: `${label}: choose an item.` };
    }
    if (seen.has(line.inventoryItemId)) {
      return { ok: false, error: `${label}: each item can appear once per order.` };
    }
    seen.add(line.inventoryItemId);
    const quantity = parseWholeNumber(line.quantity, { min: 1 });
    if (quantity === undefined) {
      return { ok: false, error: `${label}: enter a whole quantity of 1 or more.` };
    }
    let unitCostMinor: number | undefined;
    if (line.unitCost.trim() !== "") {
      const parsed = parseMoneyToMinor(line.unitCost, currency);
      if (parsed === null) {
        return { ok: false, error: `${label}: enter a unit cost like 1.25, or leave it blank.` };
      }
      unitCostMinor = parsed;
    }
    out.push({ inventoryItemId: line.inventoryItemId, quantity, unitCostMinor });
  }
  return { ok: true, lines: out };
}

export type ReceiveCheck =
  | { ok: true; lines: Array<{ lineId: string; quantityReceived: number }> }
  | { ok: false; error: string };

/** Received quantities per line (0 is allowed: nothing of that line arrived). */
export function checkReceipt(
  po: Pick<PurchaseOrder, "lines">,
  received: Readonly<Record<string, string>>,
): ReceiveCheck {
  const lines: Array<{ lineId: string; quantityReceived: number }> = [];
  for (const line of po.lines) {
    const value = parseWholeNumber(received[line.id] ?? String(line.quantityOrdered), { min: 0 });
    if (value === undefined) {
      return { ok: false, error: `${line.itemName}: enter a whole number, 0 or more.` };
    }
    lines.push({ lineId: line.id, quantityReceived: value });
  }
  return { ok: true, lines };
}

export function orderTotalMinor(
  lines: ReadonlyArray<{ quantity: number; unitCostMinor: number }>,
): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0);
}
