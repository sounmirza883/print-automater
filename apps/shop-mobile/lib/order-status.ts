import type { ShopOrderResponse } from "@print-automated/api-client";
import type { OrderStatus } from "@print-automated/types";
import type { Badge } from "./job-view.js";

// §37/9.14: "in flight" = accepted through actively printing. The Phase
// 18 job-derived statuses (PREPARING, ASSIGNED, PAUSED) sit inside that
// window, so the detail screen keeps polling across them. QUALITY_CHECK
// is deliberately not in flight: nothing is moving on its own, it waits
// for staff (workflow arrives in Phase 21).
//
// Total on purpose: adding an OrderStatus is a compile error here.
const IN_FLIGHT: Record<OrderStatus, boolean> = {
  DRAFT: false,
  UPLOADED: false,
  PAYMENT_PENDING: false,
  PAID: false,
  WAITING_FOR_SHOP: false,
  SHOP_ACCEPTED: true,
  QUEUED_FOR_PRINT: true,
  PREPARING: true,
  ASSIGNED: true,
  PRINTING: true,
  PAUSED: true,
  PRINTED: false,
  QUALITY_CHECK: false,
  READY_FOR_COLLECTION: false,
  COMPLETED: false,
  PAYMENT_FAILED: false,
  SHOP_REJECTED: false,
  PRINT_FAILED: false,
  PRINT_STATUS_UNKNOWN: false,
  CANCELLED: false,
  EXPIRED: false,
};

// §37: plain waiting text, never a fabricated percentage. null = "not
// in flight, no progress line" as an explicit answer.
const IN_FLIGHT_LABELS: Record<OrderStatus, string | null> = {
  DRAFT: null,
  UPLOADED: null,
  PAYMENT_PENDING: null,
  PAID: null,
  WAITING_FOR_SHOP: null,
  SHOP_ACCEPTED: "Preparing to print…",
  QUEUED_FOR_PRINT: "Waiting for the printer…",
  PREPARING: "Preparing print jobs…",
  ASSIGNED: "Assigned to a printer, waiting to start…",
  PRINTING: "Printing…",
  PAUSED: "Printing is paused",
  PRINTED: null,
  QUALITY_CHECK: null,
  READY_FOR_COLLECTION: null,
  COMPLETED: null,
  PAYMENT_FAILED: null,
  SHOP_REJECTED: null,
  PRINT_FAILED: null,
  PRINT_STATUS_UNKNOWN: null,
  CANCELLED: null,
  EXPIRED: null,
};

function isKnown(status: string): status is OrderStatus {
  return Object.prototype.hasOwnProperty.call(IN_FLIGHT, status);
}

/** Takes a plain string because the API may send a status this build
 * predates; an unknown one is simply not in flight. */
export function isInFlight(status: string): boolean {
  return isKnown(status) && IN_FLIGHT[status];
}

export function inFlightLabel(status: string): string | null {
  return isKnown(status) ? IN_FLIGHT_LABELS[status] : null;
}

/** 24.1 + fix wave 1: a guest's QR order has no payment step of its own -- it rests in
 * UPLOADED (shown to staff only for QR orders, under Needs Attention) until someone takes
 * payment at the counter and records it, which availableOrderActions (shared with shop-web,
 * 23.30) offers for exactly these orders. The same label shop-web shows, so the card and
 * the detail screen say why the order is waiting. */
export function qrAwaitingPaymentBadge(
  order: Pick<ShopOrderResponse, "orderStatus" | "creationSource">,
): Badge | null {
  return order.orderStatus === "UPLOADED" && order.creationSource === "QR"
    ? { label: "QR — awaiting payment", tone: "caution" }
    : null;
}
