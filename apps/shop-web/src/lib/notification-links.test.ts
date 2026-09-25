import { notificationHref, notificationLinkLabel } from "./notification-links";

describe("notificationHref", () => {
  it("opens each kind of target where it lives", () => {
    expect(notificationHref({ type: "ORDER", id: "o1", orderId: "o1" })).toBe("/orders/o1");
    expect(notificationHref({ type: "PRINTER", id: "p1", orderId: null })).toBe("/printers/p1");
    expect(notificationHref({ type: "INVENTORY_ITEM", id: "i1", orderId: null })).toBe(
      "/inventory/i1",
    );
    expect(notificationHref({ type: "PURCHASE_ORDER", id: "po1", orderId: null })).toBe(
      "/purchase-orders/po1",
    );
  });

  it("opens a print job through its order, keeping the job for highlighting", () => {
    expect(notificationHref({ type: "PRINT_JOB", id: "j1", orderId: "o9" })).toBe(
      "/orders/o9?job=j1",
    );
  });

  it("falls back to the queue for a job with no order, and to nothing without a target", () => {
    expect(notificationHref({ type: "PRINT_JOB", id: "j1", orderId: null })).toBe("/orders");
    expect(notificationHref(null)).toBeNull();
    expect(notificationLinkLabel(null)).toBeNull();
  });

  it("encodes ids so they cannot alter the path", () => {
    expect(notificationHref({ type: "ORDER", id: "a/b?c", orderId: null })).toBe(
      "/orders/a%2Fb%3Fc",
    );
  });
});
