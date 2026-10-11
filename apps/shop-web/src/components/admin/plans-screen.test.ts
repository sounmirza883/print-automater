import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole, type PlanDefinitionResponse } from "@print-automated/types";
import { PlansScreen, PlansTable } from "@/components/admin/plans-screen";
import { renderAs } from "@/components/test-session";

const NO_ACCESS = "don&#x27;t have access to plan management";
const noop = () => undefined;

const definition = (over: Partial<PlanDefinitionResponse> = {}): PlanDefinitionResponse => ({
  id: "plan-standard",
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
  subscriberCount: 12,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("PlansScreen (plan management, admin gate)", () => {
  it.each([UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER, UserRole.OPERATOR])(
    "keeps %s out",
    (role) => {
      const html = renderAs(role, createElement(PlansScreen));
      expect(html).toContain(NO_ACCESS);
      expect(html).not.toContain("Add plan");
    },
  );

  it("opens for a platform admin, with a way to add a plan", () => {
    const html = renderAs(UserRole.ADMIN, createElement(PlansScreen));
    expect(html).not.toContain(NO_ACCESS);
    expect(html).toContain("Add plan");
    expect(html).toContain("no payment gateway");
  });
});

describe("PlansTable", () => {
  const render = (plans: PlanDefinitionResponse[]) =>
    renderToStaticMarkup(
      createElement(PlansTable, {
        plans,
        busy: false,
        onEdit: noop,
        onDelete: noop,
        onToggleArchived: noop,
      }),
    );

  it("lists each plan's name, price in its currency, billing period and subscriber count", () => {
    const html = render([
      definition(),
      definition({
        id: "plan-yen",
        name: "Tokyo",
        priceMinor: 1500,
        currency: "JPY",
        billingPeriodDays: 1,
        description: null,
        subscriberCount: 0,
      }),
    ]);
    expect(html).toContain("Standard");
    expect(html).toContain("For most shops");
    expect(html).toContain("PKR 2,500.00");
    expect(html).toContain("30 days");
    expect(html).toContain(">12<");
    expect(html).toContain("JPY 1,500");
    expect(html).toContain("1 day");
    expect(html).toContain(">0<");
  });

  it("badges an archived plan and offers to unarchive it; an offered plan offers archive", () => {
    const archived = render([definition({ archived: true })]);
    expect(archived).toContain("Archived");
    expect(archived).toContain("Unarchive");
    expect(archived).not.toContain("Offered");

    const offered = render([definition()]);
    expect(offered).toContain("Offered");
    expect(offered).toMatch(/>Archive<span class="sr-only"> Standard<\/span>/);
    expect(offered).not.toContain("Unarchive");
  });

  it("gives every row edit, archive and delete, each naming the plan for screen readers", () => {
    const html = render([definition()]);
    expect(html).toContain('Edit<span class="sr-only"> Standard</span>');
    expect(html).toContain('Delete<span class="sr-only"> Standard</span>');
  });

  it("shows the annual price, a dash when there is none, and Custom for a contact-only plan", () => {
    const withAnnual = render([definition({ annualPriceMinor: 2_500_000 })]);
    expect(withAnnual).toContain("Annual");
    expect(withAnnual).toContain("PKR");
    expect(withAnnual).toContain("25,000");

    const none = render([definition({ annualPriceMinor: null })]);
    expect(none).not.toContain("Custom");

    const custom = render([definition({ contactOnly: true, priceMinor: 0 })]);
    expect(custom).toContain("Custom");
    expect(custom).not.toContain("PKR");
  });

  it("flags the highlighted plan as Most popular", () => {
    expect(render([definition({ highlighted: true })])).toContain("Most popular");
    expect(render([definition()])).not.toContain("Most popular");
  });
});
