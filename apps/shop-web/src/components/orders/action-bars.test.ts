import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserRole, type Permission } from "@print-automated/types";
import type { ShopOrderJobSummary } from "@print-automated/api-client";
import { JobCard, OrderActionBar, QrAwaitingPaymentPill } from "@/components/orders/action-bars";
import { serverPermissionsFor } from "@/components/test-role-permissions";

const canAs = (role: UserRole) => {
  const permissions = new Set(serverPermissionsFor(role));
  return (permission: Permission) => permissions.has(permission);
};

const noop = () => undefined;

function bar(
  role: UserRole,
  orderStatus: string,
  busy = false,
  creationSource: "CUSTOMER_WEB" | "COUNTER" | "QR" = "CUSTOMER_WEB",
): string {
  return renderToStaticMarkup(
    createElement(OrderActionBar, {
      order: { orderStatus, creationSource } as never,
      can: canAs(role),
      busy,
      onAction: noop,
    }),
  );
}

const pill = (orderStatus: string, creationSource?: "CUSTOMER_WEB" | "COUNTER" | "QR") =>
  renderToStaticMarkup(
    createElement(QrAwaitingPaymentPill, { order: { orderStatus, creationSource } as never }),
  );

function job(over: Partial<ShopOrderJobSummary> = {}): ShopOrderJobSummary {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    status: "QUEUED",
    printerName: "Front A4",
    blockedReason: null,
    failureReason: null,
    failureNote: null,
    reprint: null,
    ...over,
  };
}

function card(role: UserRole, j: ShopOrderJobSummary, orderStatus = "PREPARING", busy = false) {
  return renderToStaticMarkup(
    createElement(JobCard, {
      job: j,
      order: { orderStatus, pricingSnapshot: undefined } as never,
      can: canAs(role),
      busy,
      highlighted: false,
      onAction: noop,
    }),
  );
}

describe("OrderActionBar (permission gating, rendered)", () => {
  it("shows Accept/Reject to counter staff on a waiting order", () => {
    const html = bar(UserRole.SHOP_COUNTER, "WAITING_FOR_SHOP");
    expect(html).toContain("Accept order");
    expect(html).toContain("Reject order");
  });

  it("shows an operator no order-level edit buttons, but the quality check", () => {
    expect(bar(UserRole.OPERATOR, "WAITING_FOR_SHOP")).not.toContain("Accept order");
    expect(bar(UserRole.OPERATOR, "QUALITY_CHECK")).toContain("Record quality check");
    expect(bar(UserRole.SHOP_COUNTER, "QUALITY_CHECK")).not.toContain("Record quality check");
  });

  it("offers Retry and Change printer only on a failed order", () => {
    expect(bar(UserRole.SHOP_OWNER, "PRINT_FAILED")).toContain("Retry printing");
    expect(bar(UserRole.SHOP_OWNER, "PRINTING")).not.toContain("Retry printing");
  });

  it("disables every button while a request is in flight", () => {
    const html = bar(UserRole.SHOP_OWNER, "WAITING_FOR_SHOP", true);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((tag) => tag.includes("disabled"))).toBe(true);
  });

  it("offers Record payment on a guest's QR order waiting in UPLOADED (fix wave 1)", () => {
    expect(bar(UserRole.SHOP_COUNTER, "UPLOADED", false, "QR")).toContain("Record payment");
    expect(bar(UserRole.SHOP_OWNER, "UPLOADED", false, "QR")).toContain("Record payment");
    // Any other UPLOADED order is mid-checkout on the web (or a counter order being built).
    expect(bar(UserRole.SHOP_COUNTER, "UPLOADED", false, "CUSTOMER_WEB")).not.toContain(
      "Record payment",
    );
    expect(bar(UserRole.SHOP_COUNTER, "UPLOADED", false, "COUNTER")).not.toContain(
      "Record payment",
    );
    // Still gated on EDIT_ORDERS like every other order-level edit.
    expect(bar(UserRole.OPERATOR, "UPLOADED", false, "QR")).not.toContain("Record payment");
    // The existing PAYMENT_PENDING case is unchanged.
    expect(bar(UserRole.SHOP_COUNTER, "PAYMENT_PENDING")).toContain("Record payment");
  });
});

describe("QrAwaitingPaymentPill (fix wave 1)", () => {
  it("labels exactly a QR order resting in UPLOADED", () => {
    expect(pill("UPLOADED", "QR")).toContain("QR — awaiting payment");
    expect(pill("UPLOADED", "CUSTOMER_WEB")).toBe("");
    expect(pill("UPLOADED")).toBe("");
    // Once payment is recorded the order moves on, and the label goes with it.
    expect(pill("WAITING_FOR_SHOP", "QR")).toBe("");
  });
});

describe("JobCard (permission gating, rendered)", () => {
  it("gives a manager Pause on a queued job and Resume on a paused one", () => {
    expect(card(UserRole.SHOP_MANAGER, job({ status: "QUEUED" }))).toContain(">Pause<");
    const paused = card(UserRole.SHOP_MANAGER, job({ status: "PAUSED" }), "PAUSED");
    expect(paused).toContain(">Resume<");
    expect(paused).not.toContain(">Pause<");
  });

  it("gives counter staff no job buttons at all", () => {
    for (const status of ["QUEUED", "PAUSED", "FAILED", "PRINTED"]) {
      expect(card(UserRole.SHOP_COUNTER, job({ status }), "PAUSED")).not.toContain("<button");
    }
  });

  it("lets counter staff resolve an unresolved print (EDIT_ORDERS) but not an operator", () => {
    const unknown = job({ status: "UNKNOWN" });
    expect(card(UserRole.SHOP_COUNTER, unknown, "PRINT_STATUS_UNKNOWN")).toContain(">Resolve<");
    expect(card(UserRole.OPERATOR, unknown, "PRINT_STATUS_UNKNOWN")).not.toContain(">Resolve<");
  });

  it("offers Reprint on a printed job to a printer manager but not to an operator", () => {
    const printed = job({ status: "PRINTED" });
    expect(card(UserRole.PRINTER_MANAGER, printed, "PRINTED")).toContain(">Reprint<");
    expect(card(UserRole.OPERATOR, printed, "PRINTED")).not.toContain(">Reprint<");
  });

  it("offers the failure-reason picker on a failed job and says when none is recorded", () => {
    const html = card(UserRole.OPERATOR, job({ status: "FAILED" }), "PRINT_FAILED");
    expect(html).toContain("Record failure reason");
    expect(html).toContain("No failure reason recorded yet");
  });

  it("explains a job parked for manual assignment and flags a late-print hold", () => {
    expect(
      card(UserRole.SHOP_OWNER, job({ status: "WAITING", blockedReason: "AUTOMATION_DISABLED" })),
    ).toContain("Waiting for manual printer assignment");
    const held = card(
      UserRole.SHOP_OWNER,
      job({ status: "PAUSED", blockedReason: "MANUAL_APPROVAL_REQUIRED" }),
      "PAUSED",
    );
    expect(held).toContain("Held by late print");
  });

  it("shows reprint linkage", () => {
    const html = card(
      UserRole.SHOP_OWNER,
      job({
        reprint: {
          originalJobId: "aaaaaaaa-0000-0000-0000-000000000000",
          reason: "PAPER_JAM",
          additionalCostMinor: 5000,
        },
      }),
    );
    expect(html).toContain("Reprint");
    expect(html).toContain("aaaaaaaa");
    expect(html).toContain("Paper jam");
  });
});
