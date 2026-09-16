import { createOrder, startCheckout } from "./place-order.js";

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 2,
  paperSize: "A4" as const,
  color: "BW" as const,
  sides: "SINGLE" as const,
  orientation: "PORTRAIT" as const,
};

describe("createOrder", () => {
  it("posts to /api/orders with the given Idempotency-Key and returns the created order", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order-1" }),
    });
    const order = await createOrder(
      "doc-1",
      "shop-1",
      CONFIG,
      "key-1",
      fetchImpl as unknown as typeof fetch,
    );
    expect(order).toEqual({ id: "order-1" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key-1" },
      body: JSON.stringify({ documentId: "doc-1", shopId: "shop-1", printConfiguration: CONFIG }),
    });
  });

  it("throws the backend's own message on a non-ok response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: "Document is not ready." }),
    });
    await expect(
      createOrder("doc-1", "shop-1", CONFIG, "key-1", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Document is not ready.");
  });

  it("falls back to a plain message when the error body has no message", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(
      createOrder("doc-1", "shop-1", CONFIG, "key-1", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Could not place this order.");
  });
});

describe("startCheckout", () => {
  it("posts to /api/payments/checkout with the order id and returns the checkout URL", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: "https://example.test/checkout" }),
    });
    const session = await startCheckout("order-1", fetchImpl as unknown as typeof fetch);
    expect(session).toEqual({ checkoutUrl: "https://example.test/checkout" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: "order-1" }),
    });
  });

  it("throws a plain-language error on a non-ok response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(startCheckout("order-1", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Could not start checkout.",
    );
  });
});
