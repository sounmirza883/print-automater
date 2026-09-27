import type { ShopOrderResponse } from "@print-automated/api-client";

/** The action rules both clients share live in @print-automated/api-client (23.30); what
 * stays here is specific to this app's screens. */
export {
  availableJobActions,
  availableOrderActions,
  shouldSteerToReprint,
  type JobActions,
  type OrderActions,
} from "@print-automated/api-client";

/** Which delivery status changes to offer from the current status; the
 * API's DELIVERY_STATUS_INVALID is the real rule. */
export function nextDeliveryStatuses(
  status: string,
): Array<"OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "CANCELLED"> {
  switch (status) {
    case "PENDING":
      return ["OUT_FOR_DELIVERY", "CANCELLED"];
    case "OUT_FOR_DELIVERY":
      return ["DELIVERED", "FAILED", "CANCELLED"];
    default:
      return [];
  }
}

/** Printer capabilities vs the order's configuration, as a HINT for the
 * picker (the API's PRINTER_CAPABILITY_MISMATCH is authoritative). */
export function capabilityProblems(
  capabilities: { color: boolean; duplex: boolean; a4: boolean; a3: boolean } | null,
  config: ShopOrderResponse["printConfiguration"],
): string[] {
  if (capabilities === null || typeof config !== "object" || config === null) {
    return [];
  }
  const problems: string[] = [];
  if (String(config.color ?? "").toUpperCase() === "COLOR" && !capabilities.color) {
    problems.push("no colour");
  }
  const sides = String(config.sides ?? "").toUpperCase();
  if (sides.includes("DOUBLE") && !capabilities.duplex) {
    problems.push("no double-sided");
  }
  const size = String(config.paperSize ?? "").toUpperCase();
  if (size === "A4" && !capabilities.a4) {
    problems.push("no A4");
  }
  if (size === "A3" && !capabilities.a3) {
    problems.push("no A3");
  }
  return problems;
}
