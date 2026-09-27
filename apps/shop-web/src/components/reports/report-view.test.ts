import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OPERATOR_WORKLOAD_NOTICE } from "@print-automated/types";
import { ReportView, type Loaded } from "@/components/reports/reports-screen";

const envelope = {
  shopId: "shop-1",
  generatedAt: "2026-09-27T12:00:00.000Z",
  range: { from: "2026-09-25T00:00:00.000Z", to: "2026-09-28T00:00:00.000Z" },
  currency: "PKR",
  truncated: false,
};

const render = (loaded: Loaded) =>
  renderToStaticMarkup(createElement(ReportView, { loaded, onCurrency: () => undefined }));

describe("ReportView", () => {
  it("revenue: tiles, a chart labelling only the highest period, a table, and other currencies", () => {
    const html = render({
      name: "revenue",
      data: {
        ...envelope,
        report: "revenue",
        groupBy: "day",
        rows: [
          {
            bucket: "2026-09-25",
            grossRevenueMinor: 100000,
            paidOrders: 2,
            refundedMinor: 0,
            refundedOrders: 0,
            netRevenueMinor: 100000,
          },
          {
            bucket: "2026-09-26",
            grossRevenueMinor: 250000,
            paidOrders: 3,
            refundedMinor: 50000,
            refundedOrders: 1,
            netRevenueMinor: 200000,
          },
          {
            bucket: "2026-09-27",
            grossRevenueMinor: 0,
            paidOrders: 0,
            refundedMinor: 0,
            refundedOrders: 0,
            netRevenueMinor: 0,
          },
        ],
        totals: {
          grossRevenueMinor: 350000,
          paidOrders: 5,
          refundedMinor: 50000,
          refundedOrders: 1,
          netRevenueMinor: 300000,
          otherCurrencies: [
            { currency: "USD", grossRevenueMinor: 1000, refundedMinor: 0, netRevenueMinor: 1000 },
          ],
        },
      },
    });
    expect(html).toContain("Money taken per day");
    expect(html).toContain("Net revenue");
    expect(html).toContain("26 Sep");
    // The chart's accessible summary names the total and the highest period.
    expect(html).toMatch(
      /aria-label="Money taken per day: 3 periods, total [^"]*highest[^"]*26 Sep/,
    );
    // Other currencies are offered, never added in.
    expect(html).toContain("USD");
    expect(html).toContain("never added together");
    // One table row per period.
    expect(html.match(/<tr>/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("operator workload: the notice, alphabetical table, and no chart", () => {
    const html = render({
      name: "operator-workload",
      data: {
        ...envelope,
        report: "operator-workload",
        groupBy: null,
        rows: [
          {
            operatorId: "a",
            name: "Ayesha",
            jobsAssigned: 4,
            jobsCompleted: 3,
            jobsFailed: 1,
            avgCompletionSeconds: 245,
            currentAssignedJobs: 1,
          },
          {
            operatorId: "b",
            name: "Bilal",
            jobsAssigned: 2,
            jobsCompleted: 2,
            jobsFailed: 0,
            avgCompletionSeconds: null,
            currentAssignedJobs: 0,
          },
        ],
        totals: {
          jobsAssigned: 6,
          jobsCompleted: 5,
          jobsFailed: 1,
          currentAssignedJobs: 1,
          notice: OPERATOR_WORKLOAD_NOTICE,
        },
      },
    });
    expect(html).toContain(OPERATOR_WORKLOAD_NOTICE);
    expect(html).toContain("Operators (A to Z)");
    expect(html.indexOf("Ayesha")).toBeLessThan(html.indexOf("Bilal"));
    expect(html).toContain("4 min 5 s");
    expect(html).not.toContain("<svg");
  });

  it("printers: allowance in words and an empty state when there are none", () => {
    const empty = render({
      name: "printers",
      data: {
        ...envelope,
        report: "printers",
        groupBy: null,
        rows: [],
        totals: { jobsCompleted: 0, jobsFailed: 0, jobsUnknown: 0, pagesPrinted: 0 },
      },
    });
    expect(empty).toContain("This business has no printers yet.");
    const html = render({
      name: "printers",
      data: {
        ...envelope,
        report: "printers",
        groupBy: null,
        truncated: true,
        rows: [
          {
            printerId: "p1",
            name: "Front desk",
            status: "ONLINE",
            jobsCompleted: 10,
            jobsFailed: 1,
            jobsUnknown: 0,
            pagesPrinted: 420,
            avgJobDurationSeconds: 38,
            downtimeSeconds: null,
            pageLimit: {
              enabled: true,
              limit: 5000,
              period: "MONTHLY",
              pagesUsedInPeriod: 1200,
              remaining: 3800,
            },
          },
        ],
        totals: { jobsCompleted: 10, jobsFailed: 1, jobsUnknown: 0, pagesPrinted: 420 },
      },
    });
    expect(html).toContain("3,800 of 5,000 left (monthly)");
    expect(html).toContain("Only the first 200 printers are listed");
  });
});
