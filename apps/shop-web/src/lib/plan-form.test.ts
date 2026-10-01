import type { PlanDefinitionResponse } from "@print-automated/types";
import {
  createPlanDefinitionSchema,
  updatePlanDefinitionSchema,
} from "@print-automated/validation";
import {
  EMPTY_PLAN_FORM,
  checkPlanForm,
  planToForm,
  toUpdatePlanInput,
  type PlanForm,
} from "./plan-form";

const plan: PlanDefinitionResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Standard",
  priceMinor: 250_000,
  currency: "PKR",
  billingPeriodDays: 30,
  description: "For most shops",
  archived: false,
  subscriberCount: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const filled = (over: Partial<PlanForm> = {}): PlanForm => ({
  ...EMPTY_PLAN_FORM,
  name: "  Standard  ",
  price: "2500",
  currency: " pkr ",
  billingPeriodDays: "30",
  ...over,
});

const problemsOf = (form: PlanForm) => {
  const check = checkPlanForm(form);
  return check.ok ? {} : check.problems;
};

describe("checkPlanForm", () => {
  it("asks for a name and a price on an empty form, and nothing else (PKR, 30 days preset)", () => {
    expect(problemsOf(EMPTY_PLAN_FORM)).toEqual({
      name: "Enter a plan name.",
      price: "Enter an amount such as 2500 or 2500.00.",
    });
  });

  it("builds exactly the body createPlanDefinitionSchema accepts, price in minor units", () => {
    const check = checkPlanForm(filled());
    expect(check).toEqual({
      ok: true,
      input: {
        name: "Standard",
        priceMinor: 250_000,
        currency: "PKR",
        billingPeriodDays: 30,
        description: undefined,
      },
    });
    expect(check.ok && createPlanDefinitionSchema.safeParse(check.input).success).toBe(true);
  });

  it("converts the price with the currency's own minor-unit scale", () => {
    const minor = (price: string, currency: string) => {
      const check = checkPlanForm(filled({ price, currency }));
      return check.ok ? check.input.priceMinor : null;
    };
    expect(minor("2500.50", "PKR")).toBe(250_050);
    expect(minor("0", "PKR")).toBe(0);
    expect(minor("2500", "JPY")).toBe(2500);
    expect(minor("1.234", "KWD")).toBe(1234);
  });

  it("refuses more decimals than the currency has, saying what it expects", () => {
    expect(problemsOf(filled({ price: "10.555" })).price).toBe(
      "Enter an amount such as 2500 or 2500.00.",
    );
    expect(problemsOf(filled({ price: "2500.5", currency: "JPY" })).price).toBe(
      "Enter a whole amount, such as 2500.",
    );
    expect(problemsOf(filled({ price: "-5" })).price).toBeDefined();
    expect(problemsOf(filled({ price: "abc" })).price).toBeDefined();
  });

  it("caps the price at the schema's limit", () => {
    expect(problemsOf(filled({ price: "1000000.00" }))).toEqual({});
    expect(problemsOf(filled({ price: "1000000.01" })).price).toBe(
      "The most a plan can cost is PKR 1,000,000.00.",
    );
  });

  it("wants a 3-letter currency code", () => {
    expect(problemsOf(filled({ currency: "PK" })).currency).toBe(
      "Enter a 3-letter currency code, such as PKR.",
    );
    expect(problemsOf(filled({ currency: "usd" }))).toEqual({});
  });

  it.each(["", "0", "3651", "1.5", "x"])("refuses a billing period of %p days", (days) => {
    expect(problemsOf(filled({ billingPeriodDays: days })).billingPeriodDays).toBe(
      "Enter a whole number of days from 1 to 3650.",
    );
  });

  it("sends the description only when typed", () => {
    const check = checkPlanForm(filled({ description: "  For most shops " }));
    expect(check.ok && check.input.description).toBe("For most shops");
  });
});

describe("planToForm / toUpdatePlanInput", () => {
  it("round-trips a plan unchanged into an empty PATCH", () => {
    expect(planToForm(plan)).toEqual({
      name: "Standard",
      price: "2500.00",
      currency: "PKR",
      billingPeriodDays: "30",
      description: "For most shops",
    });
    const check = checkPlanForm(planToForm(plan));
    expect(check.ok && toUpdatePlanInput(plan, check.input)).toEqual({});
  });

  it("sends only what changed, in a body updatePlanDefinitionSchema accepts", () => {
    const check = checkPlanForm({ ...planToForm(plan), price: "3000", billingPeriodDays: "365" });
    const body = check.ok ? toUpdatePlanInput(plan, check.input) : null;
    expect(body).toEqual({ priceMinor: 300_000, billingPeriodDays: 365 });
    expect(updatePlanDefinitionSchema.safeParse(body).success).toBe(true);
  });

  it("changing only the currency keeps the typed amount (2500.00 PKR -> 2500.00 USD)", () => {
    const check = checkPlanForm({ ...planToForm(plan), currency: "usd" });
    expect(check.ok && toUpdatePlanInput(plan, check.input)).toEqual({ currency: "USD" });
  });

  it("clears a description by sending an empty string", () => {
    const check = checkPlanForm({ ...planToForm(plan), description: "   " });
    const body = check.ok ? toUpdatePlanInput(plan, check.input) : null;
    expect(body).toEqual({ description: "" });
    expect(updatePlanDefinitionSchema.safeParse(body).success).toBe(true);
  });
});
