import { availableOrderActions, type ShopOrderResponse } from "@print-automated/api-client";
import { OrderStatus, Permission } from "@print-automated/types";
import { inFlightLabel, isInFlight, qrAwaitingPaymentBadge } from "./order-status";
import { membershipCan } from "./permissions";

describe("order-status", () => {
  it("every OrderStatus has an in-flight decision and label consistent with it", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(typeof isInFlight(status)).toBe("boolean");
      expect(inFlightLabel(status) === null).toBe(!isInFlight(status));
    }
  });

  it("the Phase 18 job-derived statuses poll; QUALITY_CHECK waits for staff", () => {
    expect(isInFlight("PREPARING")).toBe(true);
    expect(isInFlight("ASSIGNED")).toBe(true);
    expect(isInFlight("PAUSED")).toBe(true);
    expect(isInFlight("QUALITY_CHECK")).toBe(false);
  });

  it("an unknown status is not in flight", () => {
    expect(isInFlight("SOMETHING_NEW")).toBe(false);
    expect(inFlightLabel("SOMETHING_NEW")).toBeNull();
  });
});

/** The whole order object, as the orders list and OrderActions receive it from the API. */
function order(over: Partial<ShopOrderResponse>): ShopOrderResponse {
  return {
    id: "order-1",
    publicOrderNumber: "PA-1",
    customerName: "Walk-in guest",
    documentFilename: "notes.pdf",
    printConfiguration: {
      pages: { mode: "all" },
      copies: 1,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    },
    paymentStatus: "PENDING",
    orderStatus: "UPLOADED",
    creationSource: "QR",
    createdAt: "2026-09-30T10:00:00.000Z",
    printerName: null,
    printJobs: [],
    qualityCheckStatus: null,
    delivery: null,
    ...over,
  };
}

describe("a guest's QR order awaiting payment (fix wave 1)", () => {
  const counter = membershipCan({ permissions: [Permission.VIEW_ORDERS, Permission.EDIT_ORDERS] });
  const operator = membershipCan({ permissions: [Permission.VIEW_ORDERS] });

  it("is labelled on the card and the detail screen, and nothing else is", () => {
    expect(qrAwaitingPaymentBadge(order({}))).toEqual({
      label: "QR — awaiting payment",
      tone: "caution",
    });
    expect(qrAwaitingPaymentBadge(order({ creationSource: "CUSTOMER_WEB" }))).toBeNull();
    expect(qrAwaitingPaymentBadge(order({ creationSource: undefined }))).toBeNull();
    expect(qrAwaitingPaymentBadge(order({ orderStatus: "WAITING_FOR_SHOP" }))).toBeNull();
  });

  it("gets Record payment from the order object OrderActions is handed, for a role that may edit orders", () => {
    expect(availableOrderActions(order({}), counter).recordPayment).toBe(true);
    expect(availableOrderActions(order({}), operator).recordPayment).toBe(false);
    expect(
      availableOrderActions(order({ creationSource: "CUSTOMER_WEB" }), counter).recordPayment,
    ).toBe(false);
  });

  it("labels exactly the UPLOADED orders the shared rules offer Record payment for", () => {
    for (const creationSource of ["CUSTOMER_WEB", "COUNTER", "QR", undefined] as const) {
      const candidate = order({ creationSource });
      expect(qrAwaitingPaymentBadge(candidate) !== null).toBe(
        availableOrderActions(candidate, counter).recordPayment,
      );
    }
  });
});
