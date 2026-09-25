import type { DashboardPrinter, OwnerDashboardResponse } from "@print-automated/types";
import {
  attentionItems,
  orderGroupRows,
  pageLimitStanding,
  paperNeedingRestock,
  rangeFor,
  revenueRows,
  summarizePrinters,
  totalAttention,
} from "./dashboard-view";
import { describeBlockedReason, isHeldByLatePrint } from "./job-status";

const NOW = Date.parse("2026-09-25T15:30:00Z");

function printer(over: Partial<DashboardPrinter> = {}): DashboardPrinter {
  return {
    id: "p1",
    name: "Front A4",
    status: "ONLINE",
    lastStatusAt: null,
    agent: null,
    offline: false,
    maintenanceStatus: null,
    currentJob: null,
    queue: { jobs: 0, pages: 0 },
    pageLimit: {
      enabled: false,
      limit: null,
      period: "DAILY",
      periodStart: "2026-09-25T00:00:00Z",
      pagesUsed: 0,
      remaining: null,
    },
    errors: { failedJobs24h: 0, lastFailureReason: null },
    ...over,
  };
}

describe("rangeFor", () => {
  it("builds 'today' from 00:00 UTC, matching the API's own today boundary", () => {
    expect(rangeFor("today", NOW)).toEqual({
      from: "2026-09-25T00:00:00.000Z",
      to: "2026-09-25T15:30:00.000Z",
    });
  });

  it("builds rolling windows ending now", () => {
    expect(rangeFor("7d", NOW).from).toBe("2026-09-18T15:30:00.000Z");
    expect(rangeFor("30d", NOW).from).toBe("2026-08-26T15:30:00.000Z");
  });
});

describe("attention", () => {
  const owner = {
    attention: { blockedJobs: 2, failedJobs: 0, unresolvedJobs: 1, ordersNeedingAttention: 3 },
  } as OwnerDashboardResponse;

  it("puts unresolved prints (paper may be out) first and links every item to the queue", () => {
    const items = attentionItems(owner);
    expect(items[0]?.id).toBe("unresolved");
    expect(items.every((item) => item.href.startsWith("/orders?group=needsAttention"))).toBe(true);
    expect(items.find((item) => item.id === "blocked")?.count).toBe(2);
  });

  it("totals the counts (zero means all clear)", () => {
    expect(totalAttention(owner)).toBe(6);
    expect(
      totalAttention({
        attention: { blockedJobs: 0, failedJobs: 0, unresolvedJobs: 0, ordersNeedingAttention: 0 },
      } as OwnerDashboardResponse),
    ).toBe(0);
  });
});

describe("revenueRows", () => {
  it("uses the explicit gross/refunded/net fields, never derives them", () => {
    const rows = revenueRows({
      currency: "PKR",
      grossTodayMinor: 1000,
      refundedTodayMinor: 200,
      netTodayMinor: 800,
      grossPeriodMinor: 5000,
      refundedPeriodMinor: 500,
      netPeriodMinor: 4500,
      paidOrdersInPeriod: 9,
    });
    expect(rows).toEqual([
      { period: "Today", grossMinor: 1000, refundedMinor: 200, netMinor: 800 },
      { period: "Selected period", grossMinor: 5000, refundedMinor: 500, netMinor: 4500 },
    ]);
  });
});

describe("orderGroupRows", () => {
  it("labels the five groups and links each to its filtered queue", () => {
    const rows = orderGroupRows({
      needsAttention: 1,
      printing: 2,
      ready: 3,
      completed: 4,
      failed: 5,
    });
    expect(rows.map((row) => row.label)).toEqual([
      "Needs attention",
      "Printing",
      "Ready",
      "Completed",
      "Failed",
    ]);
    expect(rows[0]?.href).toBe("/orders?group=needsAttention");
  });
});

describe("page limits", () => {
  const limited = (used: number): DashboardPrinter =>
    printer({
      pageLimit: {
        enabled: true,
        limit: 100,
        period: "DAILY",
        periodStart: "x",
        pagesUsed: used,
        remaining: Math.max(0, 100 - used),
      },
    });

  it("is off without an enforced limit, even if a number is stored", () => {
    expect(pageLimitStanding(printer())).toBe("off");
    expect(
      pageLimitStanding(
        printer({
          pageLimit: {
            enabled: false,
            limit: 100,
            period: "DAILY",
            periodStart: "x",
            pagesUsed: 500,
            remaining: null,
          },
        }),
      ),
    ).toBe("off");
  });

  it("grades ok / low / reached (a soft cap can overshoot)", () => {
    expect(pageLimitStanding(limited(10))).toBe("ok");
    expect(pageLimitStanding(limited(90))).toBe("low");
    expect(pageLimitStanding(limited(100))).toBe("reached");
    expect(pageLimitStanding(limited(130))).toBe("reached");
  });
});

describe("paperNeedingRestock", () => {
  it("flags sizes that are empty or have a low line", () => {
    expect(
      paperNeedingRestock({
        trackingEnabled: true,
        bySize: [
          { paperSize: "A4", quantity: 2000, lowStockItems: 0 },
          { paperSize: "A3", quantity: 0, lowStockItems: 0 },
          { paperSize: "LETTER", quantity: 50, lowStockItems: 1 },
        ],
      }).map((row) => row.paperSize),
    ).toEqual(["A3", "LETTER"]);
  });
});

describe("summarizePrinters", () => {
  it("counts by the derived offline flag, not the raw status", () => {
    expect(
      summarizePrinters([
        printer(),
        printer({ status: "ONLINE", offline: true }),
        printer({ status: "ERROR" }),
        printer({ status: "DISABLED" }),
      ]),
    ).toEqual({ online: 1, offline: 1, needsHelp: 1 });
  });
});

describe("describeBlockedReason", () => {
  it("shows AUTOMATION_DISABLED as waiting for manual printer assignment", () => {
    expect(describeBlockedReason("AUTOMATION_DISABLED")?.label).toBe(
      "Waiting for manual printer assignment",
    );
  });

  it("gives NO_PAPER a restock hint and a link to stock", () => {
    const view = describeBlockedReason("NO_PAPER");
    expect(view?.hint).toMatch(/restock/i);
    expect(view?.action?.href).toBe("/inventory");
  });

  it("marks a late-print hold and nothing else as held", () => {
    expect(isHeldByLatePrint("MANUAL_APPROVAL_REQUIRED")).toBe(true);
    expect(isHeldByLatePrint("AUTOMATION_DISABLED")).toBe(false);
    expect(isHeldByLatePrint(null)).toBe(false);
  });

  it("has no view for an unblocked job and degrades gracefully for an unknown reason", () => {
    expect(describeBlockedReason(null)).toBeNull();
    expect(describeBlockedReason("SOMETHING_NEW")?.label).toBe("Something new");
  });
});
