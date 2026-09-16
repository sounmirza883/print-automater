import {
  fetchOrder,
  fetchOrders,
  formatMoney,
  getOrderProgress,
  summarizeConfiguration,
} from "./orders.js";

describe("getOrderProgress", () => {
  it("maps every internal OrderStatus to a step position or a plain-language message -- never the raw status itself", () => {
    const allStatuses = [
      "DRAFT",
      "UPLOADED",
      "PAYMENT_PENDING",
      "PAID",
      "WAITING_FOR_SHOP",
      "SHOP_ACCEPTED",
      "QUEUED_FOR_PRINT",
      "PRINTING",
      "PRINTED",
      "READY_FOR_COLLECTION",
      "COMPLETED",
      "PAYMENT_FAILED",
      "SHOP_REJECTED",
      "PRINT_FAILED",
      "PRINT_STATUS_UNKNOWN",
      "CANCELLED",
      "EXPIRED",
    ];

    for (const status of allStatuses) {
      const progress = getOrderProgress(status);
      if (progress.kind === "steps") {
        expect(progress.doneCount).toBeGreaterThanOrEqual(1);
        expect(progress.doneCount).toBeLessThanOrEqual(6);
      } else {
        // §27's own Done-when: no raw internal terminology reaches the
        // customer, including inside the fallback message itself.
        expect(progress.text).not.toContain(status);
        expect(progress.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("COMPLETED has all six steps done and no current step", () => {
    expect(getOrderProgress("COMPLETED")).toEqual({
      kind: "steps",
      doneCount: 6,
      currentIndex: null,
    });
  });

  it("PAYMENT_PENDING is still awaiting payment confirmation, not already past it", () => {
    const progress = getOrderProgress("PAYMENT_PENDING");
    expect(progress).toEqual({ kind: "steps", doneCount: 1, currentIndex: 1 });
  });

  it("a genuinely unknown status still produces a message, not a crash", () => {
    const progress = getOrderProgress("SOMETHING_NEW");
    expect(progress.kind).toBe("message");
  });
});

describe("summarizeConfiguration", () => {
  it("renders plain language for an 'all pages' configuration", () => {
    const summary = summarizeConfiguration({
      pages: { mode: "all" },
      copies: 2,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    });
    expect(summary).toBe("2 copies, all pages, A4, Black & white, Single-sided");
  });

  it("renders a page range and singular 'copy'", () => {
    const summary = summarizeConfiguration({
      pages: { mode: "range", from: 3, to: 7 },
      copies: 1,
      paperSize: "A4",
      color: "COLOR",
      sides: "DOUBLE",
      orientation: "LANDSCAPE",
    });
    expect(summary).toBe("1 copy, pages 3-7, A4, Color, Double-sided");
  });
});

describe("formatMoney", () => {
  it("formats integer minor units as a two-decimal amount", () => {
    expect(formatMoney(20000, "PKR")).toBe("PKR 200.00");
    expect(formatMoney(150, "PKR")).toBe("PKR 1.50");
  });
});

describe("fetchOrders / fetchOrder", () => {
  it("fetchOrders calls the authenticated proxy and returns the parsed list", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "order-1" }],
    });
    const orders = await fetchOrders(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/orders");
    expect(orders).toEqual([{ id: "order-1" }]);
  });

  it("fetchOrders throws a plain-language error on a non-ok response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false });
    await expect(fetchOrders(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Could not load your orders.",
    );
  });

  it("fetchOrder calls the proxy for that specific order id", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order-1" }),
    });
    const order = await fetchOrder("order-1", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/orders/order-1");
    expect(order).toEqual({ id: "order-1" });
  });
});
