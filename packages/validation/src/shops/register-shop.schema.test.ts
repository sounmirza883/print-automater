import { registerShopSchema } from "./register-shop.schema.js";

function validPayload() {
  return {
    shop: {
      name: "Test Print Shop",
      address: "1 Main St",
      phone: "+923001234567",
      capabilities: { color: true, duplex: true, a4: true, a3: false },
    },
    owner: {
      name: "Owner Name",
      email: "owner@example.com",
      password: "correcthorsebatterystaple",
      phone: "+923001234568",
    },
    pricing: {
      currency: "PKR",
      pricePerPageMinor: 1000,
      colorSurchargePerPageMinor: 500,
      minimumChargeMinor: 5000,
    },
  };
}

describe("registerShopSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerShopSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it("rejects missing shop capabilities", () => {
    const payload = validPayload();
    // @ts-expect-error deliberately malformed for the test
    delete payload.shop.capabilities;
    expect(registerShopSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a negative pricePerPageMinor", () => {
    const payload = validPayload();
    payload.pricing.pricePerPageMinor = -1;
    expect(registerShopSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a negative minimumChargeMinor", () => {
    const payload = validPayload();
    payload.pricing.minimumChargeMinor = -1;
    expect(registerShopSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects an invalid owner email, reusing registerSchema's own rule", () => {
    const payload = validPayload();
    payload.owner.email = "not-an-email";
    expect(registerShopSchema.safeParse(payload).success).toBe(false);
  });

  it("never accepts a shopId in the pricing sub-object (assigned server-side)", () => {
    const payload = validPayload() as Record<string, unknown>;
    (payload.pricing as Record<string, unknown>).shopId = "11111111-1111-1111-1111-111111111111";
    const result = registerShopSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pricing).not.toHaveProperty("shopId");
    }
  });
});
