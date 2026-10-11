import { activatePlanSchema } from "./activate-plan.schema.js";
import {
  createPlanDefinitionSchema,
  updatePlanDefinitionSchema,
} from "./plan-definition.schema.js";

const valid = () => ({
  name: "Standard Monthly",
  priceMinor: 250_000,
  currency: "PKR",
  billingPeriodDays: 30,
  description: "Everything a single-counter business needs.",
});

describe("createPlanDefinitionSchema (platform-wide plan tiers)", () => {
  it("accepts a named plan with a price, currency and billing period", () => {
    const result = createPlanDefinitionSchema.safeParse(valid());
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual(valid());
  });

  it("description is optional", () => {
    const { description, ...withoutDescription } = valid();
    void description;
    expect(createPlanDefinitionSchema.safeParse(withoutDescription).success).toBe(true);
  });

  it.each(["name", "priceMinor", "currency", "billingPeriodDays"] as const)(
    "requires %s",
    (field) => {
      const body: Record<string, unknown> = valid();
      delete body[field];
      expect(createPlanDefinitionSchema.safeParse(body).success).toBe(false);
    },
  );

  it("trims the name and refuses a blank or over-long one", () => {
    const trimmed = createPlanDefinitionSchema.safeParse({ ...valid(), name: "  Pro  " });
    expect(trimmed.success && trimmed.data.name).toBe("Pro");
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), name: "   " }).success).toBe(false);
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), name: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("price is integer minor units: zero (a free tier) is allowed; negative or fractional is not", () => {
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), priceMinor: 0 }).success).toBe(true);
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), priceMinor: -1 }).success).toBe(
      false,
    );
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), priceMinor: 10.5 }).success).toBe(
      false,
    );
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), priceMinor: 100_000_001 }).success,
    ).toBe(false);
  });

  it("upper-cases a 3-letter currency code and refuses anything else", () => {
    const lower = createPlanDefinitionSchema.safeParse({ ...valid(), currency: " usd " });
    expect(lower.success && lower.data.currency).toBe("USD");
    for (const currency of ["US", "USDT", "U5D", ""]) {
      expect(createPlanDefinitionSchema.safeParse({ ...valid(), currency }).success).toBe(false);
    }
  });

  it("billing period is a whole number of days between 1 and 3650", () => {
    for (const billingPeriodDays of [1, 30, 365, 3650]) {
      expect(createPlanDefinitionSchema.safeParse({ ...valid(), billingPeriodDays }).success).toBe(
        true,
      );
    }
    for (const billingPeriodDays of [0, -30, 3651, 7.5]) {
      expect(createPlanDefinitionSchema.safeParse({ ...valid(), billingPeriodDays }).success).toBe(
        false,
      );
    }
  });

  it("never carries a client-supplied id, archived flag or subscriber count", () => {
    const result = createPlanDefinitionSchema.safeParse({
      ...valid(),
      id: "00000000-0000-4000-8000-000000000000",
      archived: true,
      subscriberCount: 99,
    });
    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data).sort()).toEqual(
      ["billingPeriodDays", "currency", "description", "name", "priceMinor"].sort(),
    );
  });
});

describe("updatePlanDefinitionSchema (partial PATCH)", () => {
  it("accepts an empty body and any single field", () => {
    expect(updatePlanDefinitionSchema.safeParse({}).success).toBe(true);
    expect(updatePlanDefinitionSchema.safeParse({ priceMinor: 99 }).success).toBe(true);
    expect(updatePlanDefinitionSchema.safeParse({ archived: true }).success).toBe(true);
  });

  it("description can be cleared with null", () => {
    const result = updatePlanDefinitionSchema.safeParse({ description: null });
    expect(result.success && result.data.description).toBeNull();
  });

  it("applies the same per-field rules as create", () => {
    expect(updatePlanDefinitionSchema.safeParse({ name: "" }).success).toBe(false);
    expect(updatePlanDefinitionSchema.safeParse({ priceMinor: -5 }).success).toBe(false);
    expect(updatePlanDefinitionSchema.safeParse({ currency: "rupees" }).success).toBe(false);
    expect(updatePlanDefinitionSchema.safeParse({ billingPeriodDays: 0 }).success).toBe(false);
    const upper = updatePlanDefinitionSchema.safeParse({ currency: "eur" });
    expect(upper.success && upper.data.currency).toBe("EUR");
  });

  it("archived must be a real boolean", () => {
    expect(updatePlanDefinitionSchema.safeParse({ archived: "yes" }).success).toBe(false);
  });

  it("drops a smuggled id or subscriber count", () => {
    const result = updatePlanDefinitionSchema.safeParse({ id: "x", subscriberCount: 3 });
    expect(result.success && Object.keys(result.data)).toEqual([]);
  });
});

describe("activatePlanSchema (assign a named plan, not a raw day count)", () => {
  it("accepts a plan definition id", () => {
    expect(
      activatePlanSchema.safeParse({ planDefinitionId: "3f0c8f1e-2b7a-4c6d-9e1f-0a1b2c3d4e5f" })
        .success,
    ).toBe(true);
  });

  it("refuses a non-uuid id and the old { days } body", () => {
    expect(activatePlanSchema.safeParse({ planDefinitionId: "basic" }).success).toBe(false);
    expect(activatePlanSchema.safeParse({ days: 30 }).success).toBe(false);
  });
});

describe("plan pricing fields", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts annual price, badge, contact-only, sort order and values", () => {
    const result = createPlanDefinitionSchema.safeParse({
      ...valid(),
      annualPriceMinor: 6_000_000,
      highlighted: true,
      contactOnly: false,
      sortOrder: 20,
      values: { [uuid]: "10" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a values key that is not a uuid, and a blank value", () => {
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), values: { nope: "1" } }).success,
    ).toBe(false);
    expect(
      createPlanDefinitionSchema.safeParse({ ...valid(), values: { [uuid]: "  " } }).success,
    ).toBe(false);
  });

  it("update: annualPriceMinor null clears it", () => {
    const result = updatePlanDefinitionSchema.safeParse({ annualPriceMinor: null });
    expect(result.success && result.data.annualPriceMinor).toBeNull();
  });

  it("rejects a negative annual price and an out-of-range sort order", () => {
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), annualPriceMinor: -1 }).success).toBe(
      false,
    );
    expect(createPlanDefinitionSchema.safeParse({ ...valid(), sortOrder: 1001 }).success).toBe(
      false,
    );
  });
});
