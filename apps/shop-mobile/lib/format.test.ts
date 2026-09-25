import { formatMoney, formatOrderTotal, summarizeConfiguration } from "./format.js";
import type { ShopOrderResponse } from "@print-automated/api-client";

const BASE_ORDER: ShopOrderResponse = {
  id: "order-1",
  publicOrderNumber: "PA-20260101-000001",
  customerName: "Ann",
  documentFilename: "a.pdf",
  printConfiguration: {
    pages: { mode: "all" },
    copies: 2,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  },
  pricingSnapshot: { quote: { totalMinor: 4000, currency: "PKR" } },
  paymentStatus: "PAID",
  orderStatus: "WAITING_FOR_SHOP",
  createdAt: "2026-01-01T00:00:00.000Z",
  printerName: null,
  printJobs: [],
  qualityCheckStatus: null,
  delivery: null,
};

describe("summarizeConfiguration", () => {
  it("renders plain language for an 'all pages' configuration", () => {
    expect(summarizeConfiguration(BASE_ORDER.printConfiguration)).toBe(
      "2 copies, all pages, A4, Black & white, Single-sided",
    );
  });

  it("renders a page range and singular 'copy'", () => {
    expect(
      summarizeConfiguration({
        pages: { mode: "range", from: 3, to: 7 },
        copies: 1,
        paperSize: "A4",
        color: "COLOR",
        sides: "DOUBLE",
        orientation: "LANDSCAPE",
      }),
    ).toBe("1 copy, pages 3-7, A4, Color, Double-sided");
  });
});

describe("formatMoney", () => {
  it("formats integer minor units as a two-decimal amount", () => {
    expect(formatMoney(4000, "PKR")).toBe("PKR 40.00");
  });
});

describe("formatOrderTotal", () => {
  it("formats a real quote", () => {
    expect(formatOrderTotal(BASE_ORDER)).toBe("PKR 40.00");
  });

  it("degrades to '--' for an order with no pricing snapshot quote", () => {
    expect(formatOrderTotal({ ...BASE_ORDER, pricingSnapshot: undefined })).toBe("--");
    expect(formatOrderTotal({ ...BASE_ORDER, pricingSnapshot: {} })).toBe("--");
  });
});
