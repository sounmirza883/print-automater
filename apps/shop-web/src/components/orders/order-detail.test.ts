import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShopOrderDetail, ShopOrderJobSummary } from "@print-automated/api-client";
import { UserRole } from "@print-automated/types";
import { JobCard } from "@/components/orders/action-bars";
import { OrderItems, OrderSummary } from "@/components/orders/order-detail";
import { serverPermissionsFor } from "@/components/test-role-permissions";

function detail(over: Partial<ShopOrderDetail> = {}): ShopOrderDetail {
  return {
    id: "order-1",
    publicOrderNumber: "PA-1",
    customerName: "Ayesha Khan",
    documentFilename: "thesis.pdf",
    printConfiguration: {
      pages: { mode: "all" },
      copies: 2,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    },
    pricingSnapshot: { quote: { totalMinor: 150000, currency: "PKR" } },
    paymentStatus: "PAID",
    orderStatus: "PRINTING",
    createdAt: "2026-09-27T09:00:00.000Z",
    printerName: "Front desk",
    printJobs: [],
    qualityCheckStatus: null,
    delivery: null,
    priority: 0,
    pricingRuleVersion: 3,
    items: [],
    customerContact: {
      kind: "ACCOUNT",
      name: "Ayesha Khan",
      phone: "0300-1234567",
      email: "ayesha@example.com",
    },
    payment: {
      provider: "manual",
      status: "PAID",
      amountMinor: 150000,
      currency: "PKR",
      paidAt: "2026-09-27T09:05:00.000Z",
    },
    refunds: { count: 0, refundedMinor: 0, pendingMinor: 0, currency: null },
    ...over,
  } as ShopOrderDetail;
}

const summary = (order: ShopOrderDetail) =>
  renderToStaticMarkup(createElement(OrderSummary, { order }));

describe("OrderSummary (23.13)", () => {
  it("shows the customer's contact to a role allowed to see it", () => {
    const html = summary(detail());
    expect(html).toContain("0300-1234567");
    expect(html).toContain("ayesha@example.com");
    expect(html).toContain("Priced with price list version 3");
    expect(html).toContain("via manual");
  });

  it("says contact is hidden for the role instead of showing blanks", () => {
    const html = summary(
      detail({
        customerContact: {
          kind: "WALK_IN",
          name: "Walk-in Bilal",
          phone: null,
          email: null,
          contactRedacted: true,
        },
      }),
    );
    expect(html).toContain("Hidden for your role");
    expect(html).toContain("walk-in");
    expect(html).not.toContain("None on record");
  });

  it("covers an order with no payment, refunds, a pre-versioning price and a raised priority", () => {
    const html = summary(
      detail({
        payment: null,
        pricingRuleVersion: null,
        priority: 20,
        refunds: { count: 1, refundedMinor: 50000, pendingMinor: 25000, currency: "PKR" },
      }),
    );
    expect(html).toContain("No payment on record");
    expect(html).toContain("Priced before price lists were versioned");
    expect(html).toContain("Urgent");
    expect(html).toMatch(/Refunds:.*returned.*pending/);
  });
});

describe("OrderItems (23.13)", () => {
  it("lists each line, including the one synthesised before acceptance (id null)", () => {
    const html = renderToStaticMarkup(
      createElement(OrderItems, {
        order: detail({
          items: [
            {
              id: null,
              sequence: 1,
              itemType: "DOCUMENT",
              required: true,
              documentName: "thesis.pdf",
              quantity: 3,
              printConfiguration: { paperSize: "A4", color: "BW", sides: "SINGLE", copies: 2 },
              status: null,
              priceMinor: 150000,
            },
          ],
        }),
      }),
    );
    expect(html).toContain("thesis.pdf");
    expect(html).toContain("3 sets");
    expect(html).toContain("1 line");
  });

  it("renders nothing without items", () => {
    expect(renderToStaticMarkup(createElement(OrderItems, { order: detail() }))).toBe("");
  });
});

describe("JobCard timing (23.13)", () => {
  it("shows the attempt, when it was created and paused, and a raised priority", () => {
    const permissions = new Set(serverPermissionsFor(UserRole.OPERATOR));
    const job: ShopOrderJobSummary = {
      id: "job-12345678",
      status: "PAUSED",
      printerName: null,
      blockedReason: null,
      failureReason: null,
      failureNote: null,
      reprint: null,
      attempt: 2,
      priority: 10,
      createdAt: "2026-09-27T09:00:00.000Z",
      updatedAt: "2026-09-27T09:10:00.000Z",
      pausedAt: "2026-09-27T09:10:00.000Z",
      supersededAt: null,
    };
    const html = renderToStaticMarkup(
      createElement(JobCard, {
        job,
        order: { orderStatus: "PAUSED", pricingSnapshot: undefined },
        can: (permission) => permissions.has(permission),
        busy: false,
        highlighted: false,
        onAction: () => undefined,
      }),
    );
    expect(html).toContain("Attempt 2");
    expect(html).toContain("Created");
    expect(html).toContain("Paused");
    expect(html).toContain("High priority");
  });
});
