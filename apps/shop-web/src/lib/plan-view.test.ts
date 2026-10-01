import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import {
  activateLabel,
  assignablePlans,
  assignedPlanName,
  billingPeriodLabel,
  defaultPlanChoice,
  isPlanInUse,
  planOptionLabel,
  planPriceLabel,
  planStateLabel,
} from "./plan-view";

const definition = (over: Partial<PlanDefinitionResponse> = {}): PlanDefinitionResponse => ({
  id: "plan-standard",
  name: "Standard",
  priceMinor: 250_000,
  currency: "PKR",
  billingPeriodDays: 30,
  description: null,
  archived: false,
  subscriberCount: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const standard = definition();
const yearly = definition({ id: "plan-yearly", name: "Yearly", billingPeriodDays: 365 });
const legacy = definition({ id: "plan-legacy", name: "Legacy", archived: true });

const assignment = (over: Partial<ShopPlanResponse> = {}): ShopPlanResponse => ({
  shopId: "shop-1",
  active: true,
  expiresAt: "2026-10-31T00:00:00.000Z",
  activatedAt: "2026-10-01T00:00:00.000Z",
  plan: standard,
  ...over,
});

describe("plan labels", () => {
  it("reads a billing period in days", () => {
    expect(billingPeriodLabel(30)).toBe("30 days");
    expect(billingPeriodLabel(1)).toBe("1 day");
    expect(billingPeriodLabel(1825)).toBe("1,825 days");
  });

  it("puts the price, in its own currency, next to the period", () => {
    expect(planPriceLabel(standard)).toBe("PKR 2,500.00 per 30 days");
    expect(planOptionLabel(yearly)).toBe("Yearly (PKR 2,500.00 per 365 days)");
  });
});

describe("assignablePlans / defaultPlanChoice", () => {
  it("never offers an archived plan", () => {
    expect(assignablePlans([standard, legacy, yearly]).map((p) => p.id)).toEqual([
      "plan-standard",
      "plan-yearly",
    ]);
  });

  it("starts on the business's current plan, so one click renews it", () => {
    const choices = [standard, yearly];
    expect(defaultPlanChoice(assignment({ plan: yearly }), choices)).toBe("plan-yearly");
  });

  it("falls back to the first plan when the current one cannot be chosen (archived, none, unknown)", () => {
    const choices = assignablePlans([standard, legacy, yearly]);
    expect(defaultPlanChoice(assignment({ plan: legacy }), choices)).toBe("plan-standard");
    expect(defaultPlanChoice(assignment({ plan: null }), choices)).toBe("plan-standard");
    expect(defaultPlanChoice(null, choices)).toBe("plan-standard");
    expect(defaultPlanChoice(null, [])).toBe("");
  });
});

describe("activateLabel", () => {
  it("says renew for the current plan, change for another while active, activate otherwise", () => {
    expect(activateLabel(assignment(), "plan-standard")).toBe("Renew plan");
    expect(activateLabel(assignment({ active: false }), "plan-standard")).toBe("Renew plan");
    expect(activateLabel(assignment(), "plan-yearly")).toBe("Change plan");
    expect(activateLabel(assignment({ active: false }), "plan-yearly")).toBe("Activate plan");
    expect(activateLabel(null, "plan-yearly")).toBe("Activate plan");
  });
});

describe("assignedPlanName / planStateLabel", () => {
  it("names the plan, or what stands in for one", () => {
    expect(assignedPlanName(assignment())).toBe("Standard");
    expect(assignedPlanName(assignment({ plan: null }))).toBe("No named plan");
    expect(assignedPlanName(assignment({ plan: null, expiresAt: null, active: false }))).toBe(
      "None yet",
    );
  });

  it("tells expired apart from never activated", () => {
    expect(planStateLabel(assignment())).toBe("Active");
    expect(planStateLabel(assignment({ active: false }))).toBe("Expired");
    expect(planStateLabel(assignment({ active: false, expiresAt: null }))).toBe("Not active");
  });
});

describe("isPlanInUse", () => {
  it("is the API's 409 refusal, nothing else", () => {
    expect(isPlanInUse({ status: 409, error_code: "CONFLICT", message: "3 businesses" })).toBe(
      true,
    );
    expect(isPlanInUse({ status: 404 })).toBe(false);
    expect(isPlanInUse(new Error("offline"))).toBe(false);
    expect(isPlanInUse(null)).toBe(false);
  });
});
