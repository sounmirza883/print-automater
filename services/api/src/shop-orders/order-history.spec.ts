import { sanitizeHistoryMetadata } from "./order-history.js";

describe("sanitizeHistoryMetadata (23.13)", () => {
  it("redacts credentials, payment links/ids, delivery address and contact keys, recursively", () => {
    const out = sanitizeHistoryMetadata({
      reason: "manual",
      from: "QUEUED",
      token: "t",
      deliveryAddress: "12 Secret Lane",
      checkoutUrl: "https://pay",
      nested: { providerPaymentId: "p", phone: "1", keep: 2, list: [{ email: "e", ok: true }] },
    }) as Record<string, unknown>;
    expect(out).toEqual({
      reason: "manual",
      from: "QUEUED",
      token: "[REDACTED]",
      deliveryAddress: "[REDACTED]",
      checkoutUrl: "[REDACTED]",
      nested: {
        providerPaymentId: "[REDACTED]",
        phone: "[REDACTED]",
        keep: 2,
        list: [{ email: "[REDACTED]", ok: true }],
      },
    });
  });

  it("passes non-object metadata through", () => {
    expect(sanitizeHistoryMetadata(null)).toBeNull();
    expect(sanitizeHistoryMetadata("x")).toBe("x");
  });
});
