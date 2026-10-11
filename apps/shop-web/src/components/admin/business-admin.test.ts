import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import { OwnerPanel, PlanPanelBody } from "@/components/admin/business-detail";
import { BusinessCreatedNotice } from "@/components/admin/businesses-screen";

const noop = () => undefined;

describe("BusinessCreatedNotice (fix wave 1: no password to hand over)", () => {
  it("tells the admin the owner was emailed a code, naming the address and where to use it", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessCreatedNotice, {
        created: {
          id: "shop-9",
          name: "Corner Prints",
          address: "1 Mall Road",
          status: "CLOSED",
          createdAt: "2026-09-30T10:00:00.000Z",
          owner: { id: "u-9", name: "Ayesha Khan", email: "ayesha@example.com" },
        } as never,
        onDismiss: noop,
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Corner Prints");
    expect(html).toContain('href="/admin/businesses/shop-9"');
    expect(html).toContain("ayesha@example.com");
    expect(html).toContain("activation code");
    expect(html).toContain("Set up your account");
    expect(html).not.toMatch(/password is|temporary password/i);
  });
});

describe("OwnerPanel (fix wave 1)", () => {
  const owner = { id: "u-9", name: "Ayesha Khan", email: "ayesha@example.com" };
  const render = (value: Parameters<typeof OwnerPanel>[0]["owner"]) =>
    renderToStaticMarkup(
      createElement(OwnerPanel, { businessId: "shop-9", owner: value, onChanged: noop }),
    );

  it("shows a pending owner with a way to send a fresh code", () => {
    const html = render({ ...owner, activationPending: true });
    expect(html).toContain("Ayesha Khan");
    expect(html).toContain("ayesha@example.com");
    expect(html).toContain("Activation pending");
    expect(html).toContain("Send a new code");
  });

  it("offers no code to an owner who has already set their password", () => {
    const html = render({ ...owner, activationPending: false });
    expect(html).toContain("Active");
    expect(html).not.toContain("Activation pending");
    expect(html).not.toContain("Send a new code");
  });

  it("says so when a business predates named owners", () => {
    const html = render(null);
    expect(html).toContain("No owner on record");
    expect(html).not.toContain("<button");
  });
});

describe("PlanPanelBody (plan management: this business's own plan)", () => {
  const standard: PlanDefinitionResponse = {
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
    subscriberCount: 4,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const yearly: PlanDefinitionResponse = {
    ...standard,
    id: "plan-yearly",
    name: "Yearly",
    priceMinor: 2_500_000,
    billingPeriodDays: 365,
  };
  const current = (over: Partial<ShopPlanResponse> = {}): ShopPlanResponse => ({
    shopId: "shop-9",
    active: true,
    expiresAt: "2026-10-31T12:00:00.000Z",
    activatedAt: "2026-10-01T12:00:00.000Z",
    plan: standard,
    ...over,
  });
  const render = (value: ShopPlanResponse, plans = [standard, yearly]) =>
    renderToStaticMarkup(
      createElement(PlanPanelBody, {
        businessId: "shop-9",
        businessName: "Corner Prints",
        current: value,
        plans,
        onChanged: noop,
      }),
    );

  it("shows the assigned plan's name, price and currency, state and expiry", () => {
    const html = render(current());
    expect(html).toContain("Standard");
    expect(html).toContain("PKR 2,500.00 per 30 days");
    expect(html).toContain("Active until");
    expect(html).toContain("Oct 31, 2026");
  });

  it("lets the admin renew, change or cancel it from here", () => {
    const html = render(current());
    expect(html).toContain('<option value="plan-standard" selected="">');
    expect(html).toContain("Yearly (PKR 25,000.00 per 365 days)");
    expect(html).toContain("Renew plan");
    expect(html).toContain("Cancel plan");
  });

  it("reads an expired plan as ended, offering to remove it (not re-cancel it)", () => {
    const html = render(current({ active: false }));
    expect(html).toContain("Expired");
    expect(html).toContain("Ended");
    // Still has a named plan assigned -- removable so the plan can later be
    // deleted, but "Cancel" would be a lie for a plan that already ended.
    expect(html).toContain("Remove plan");
    expect(html).not.toContain("Cancel plan");
  });

  it("says plainly when a business has never had a plan", () => {
    const html = render(current({ active: false, expiresAt: null, activatedAt: null, plan: null }));
    expect(html).toContain("None yet");
    expect(html).toContain("Never activated");
    expect(html).toContain("Not active");
    expect(html).toContain("Activate plan");
  });

  it("explains an archived plan cannot be renewed as-is", () => {
    const html = render(current({ plan: { ...standard, archived: true } }), [yearly]);
    expect(html).toContain("Archived");
    expect(html).toContain("cannot be chosen again");
    expect(html).toContain("Change plan");
  });
});
