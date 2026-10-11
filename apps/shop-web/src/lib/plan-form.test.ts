import type { PlanDefinitionResponse } from "@print-automated/types";
import {
  createPlanDefinitionSchema,
  updatePlanDefinitionSchema,
} from "@print-automated/validation";
import {
  EMPTY_PLAN_FORM,
  checkPlanForm,
  modeToValue,
  planToForm,
  toUpdatePlanInput,
  valueMode,
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
  annualPriceMinor: null,
  highlighted: false,
  contactOnly: false,
  sortOrder: 0,
  values: {},
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
  annualPrice: "",
  highlighted: false,
  contactOnly: false,
  sortOrder: "0",
  values: {},
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
        highlighted: false,
        contactOnly: false,
        sortOrder: 0,
        values: {},
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
      annualPrice: "",
      highlighted: false,
      contactOnly: false,
      sortOrder: "0",
      values: {},
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

  it("clears a description by sending null, not an empty string", () => {
    const check = checkPlanForm({ ...planToForm(plan), description: "   " });
    const body = check.ok ? toUpdatePlanInput(plan, check.input) : null;
    expect(body).toEqual({ description: null });
    expect(updatePlanDefinitionSchema.safeParse(body).success).toBe(true);
  });
});

describe("pricing fields", () => {
  it("converts annual price to minor units and sends sort order, badge and values", () => {
    const check = checkPlanForm(
      filled({
        annualPrice: "25000",
        highlighted: true,
        sortOrder: "20",
        values: { f1: "true", f2: "10", f3: "false", f4: "" },
      }),
    );
    expect(check.ok && check.input).toMatchObject({
      annualPriceMinor: 2_500_000,
      highlighted: true,
      sortOrder: 20,
      values: { f1: "true", f2: "10" },
    });
    // dashes (false / empty) are NOT sent: a missing row is a dash.
    expect(check.ok && Object.keys(check.input.values ?? {})).not.toContain("f3");
    expect(check.ok && Object.keys(check.input.values ?? {})).not.toContain("f4");
  });

  it("annual price is optional (blank = none)", () => {
    const check = checkPlanForm(filled({ annualPrice: "" }));
    expect(check.ok && check.input.annualPriceMinor).toBeUndefined();
  });

  it("a contact-only plan needs no price and sends 0", () => {
    const check = checkPlanForm(filled({ contactOnly: true, price: "" }));
    expect(check.ok && check.input).toMatchObject({ contactOnly: true, priceMinor: 0 });
  });

  it("a contact-only plan keeps a price that was already typed", () => {
    const check = checkPlanForm(filled({ contactOnly: true, price: "2500" }));
    expect(check.ok && check.input.priceMinor).toBe(250_000);
  });

  it("rejects a bad annual price and sort order", () => {
    expect(problemsOf(filled({ annualPrice: "abc" })).annualPrice).toBeDefined();
    expect(problemsOf(filled({ sortOrder: "-1" })).sortOrder).toBeDefined();
  });

  it("toUpdatePlanInput sends annualPriceMinor: null when the annual price is cleared", () => {
    const withAnnual = { ...plan, annualPriceMinor: 2_500_000 };
    const check = checkPlanForm({ ...planToForm(withAnnual), annualPrice: "" });
    expect(check.ok && toUpdatePlanInput(withAnnual, check.input)).toEqual({
      annualPriceMinor: null,
    });
  });

  it("toUpdatePlanInput sends values only when they changed", () => {
    const withValues = { ...plan, values: { f1: "10" } };
    const same = checkPlanForm(planToForm(withValues));
    expect(same.ok && toUpdatePlanInput(withValues, same.input)).toEqual({});
    const changed = checkPlanForm({ ...planToForm(withValues), values: { f1: "11" } });
    expect(changed.ok && toUpdatePlanInput(withValues, changed.input)).toEqual({
      values: { f1: "11" },
    });
  });
});

describe("value modes", () => {
  it.each([
    ["true", "yes"],
    ["false", "no"],
    ["", "no"],
    ["10", "text"],
    ["Unlimited", "text"],
  ] as const)("%s -> %s", (value, mode) => expect(valueMode(value)).toBe(mode));

  it("modeToValue", () => {
    expect(modeToValue("yes", "")).toBe("true");
    expect(modeToValue("no", "x")).toBe("false");
    expect(modeToValue("text", "10")).toBe("10");
  });
});
