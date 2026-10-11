import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import { PlanTable, type PlanRow } from "@/components/dashboard/plan-management-panel";

const noop = () => undefined;

const definition = (over: Partial<PlanDefinitionResponse> = {}): PlanDefinitionResponse => ({
  id: "plan-standard",
  name: "Standard",
  priceMinor: 250_000,
  currency: "PKR",
  billingPeriodDays: 30,
  description: null,
  archived: false,
  annualPriceMinor: null,
  highlighted: false,
  contactOnly: false,
  sortOrder: 0,
  values: {},
  subscriberCount: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const standard = definition();
const yearly = definition({ id: "plan-yearly", name: "Yearly", billingPeriodDays: 365 });
const legacy = definition({ id: "plan-legacy", name: "Legacy", archived: true });

const business = (id: string, name: string) =>
  ({
    id,
    name,
    address: "1 Mall Road",
    status: "OPEN",
    createdAt: "2026-09-01T00:00:00.000Z",
  }) as PlanRow["business"];

const assignment = (over: Partial<ShopPlanResponse> = {}): ShopPlanResponse => ({
  shopId: "shop-1",
  active: true,
  expiresAt: "2026-10-31T12:00:00.000Z",
  activatedAt: "2026-10-01T12:00:00.000Z",
  plan: yearly,
  ...over,
});

const render = (rows: PlanRow[], plans: PlanDefinitionResponse[] = [standard, legacy, yearly]) =>
  renderToStaticMarkup(createElement(PlanTable, { rows, plans, onPlanChanged: noop }));

describe("PlanTable (plan management on the Platform dashboard)", () => {
  it("names each business's current plan and links to the business", () => {
    const html = render([{ business: business("shop-1", "Corner Prints"), plan: assignment() }]);
    expect(html).toContain('href="/admin/businesses/shop-1"');
    expect(html).toContain("Corner Prints");
    expect(html).toContain("Yearly");
    expect(html).toContain("Active");
    expect(html).toContain("until");
    expect(html).toContain('href="/admin/plans"');
  });

  it("picks from named, non-archived plans (with prices), starting on the current plan", () => {
    const html = render([{ business: business("shop-1", "Corner Prints"), plan: assignment() }]);
    expect(html).toContain("Standard (PKR 2,500.00 per 30 days)");
    expect(html).toContain('<option value="plan-yearly" selected="">');
    expect(html).not.toContain('value="plan-legacy"');
    expect(html).toContain("Renew plan");
    expect(html).not.toMatch(/type="number"/);
  });

  it("offers Cancel plan while active, and Remove plan once it's lapsed (both unassign it)", () => {
    const active = render([{ business: business("shop-1", "A"), plan: assignment() }]);
    expect(active).toContain("Cancel plan");

    const expired = render([
      { business: business("shop-1", "A"), plan: assignment({ active: false }) },
    ]);
    expect(expired).toContain("Expired");
    // Still assigned, so still unassignable -- as "Remove", since it already ended.
    expect(expired).toContain("Remove plan");
    expect(expired).not.toContain("Cancel plan");
  });

  it("shows the business on an archived plan as such, and offers a different plan", () => {
    const html = render([
      { business: business("shop-1", "A"), plan: assignment({ plan: legacy }) },
    ]);
    expect(html).toContain("Legacy");
    expect(html).toContain("Archived plan");
    expect(html).toContain('<option value="plan-standard" selected="">');
    expect(html).toContain("Change plan");
  });

  it("still lets an admin activate a business whose status could not be loaded", () => {
    const html = render([{ business: business("shop-1", "A"), plan: null }]);
    expect(html).toContain("Unavailable");
    expect(html).toContain("Activate plan");
    expect(html).not.toContain("Cancel plan");
  });

  it("points to the Plans page when there is nothing to assign", () => {
    const html = render([{ business: business("shop-1", "A"), plan: assignment() }], [legacy]);
    expect(html).toContain("No plans to choose from");
    expect(html).not.toContain("<select");
    expect(html).toContain("Cancel plan");
  });

  it("says so when there are no businesses", () => {
    expect(render([])).toContain("No businesses yet.");
  });
});
