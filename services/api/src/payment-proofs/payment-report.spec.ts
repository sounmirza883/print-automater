import {
  buildPaymentReport,
  chooseGroupBy,
  minorToMajor,
  paymentExportRows,
  summarySheetRows,
  type ReportProof,
} from "./payment-report.js";

const proof = (over: Partial<ReportProof>): ReportProof => ({
  status: "APPROVED",
  amountMinor: 600_000,
  currency: "PKR",
  planName: "Starter",
  shopName: "Corner Copies",
  transactionRef: "TX-1",
  grantedMonths: 1,
  rejectionReason: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  reviewedAt: new Date("2026-10-02T08:00:00.000Z"),
  ...over,
});

const range = {
  from: new Date("2026-10-01T00:00:00.000Z"),
  to: new Date("2026-11-01T00:00:00.000Z"),
  groupBy: "day" as const,
  tzOffsetMinutes: 0,
};

describe("chooseGroupBy", () => {
  it("uses days for ranges up to ~2 months and months beyond, unless asked", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(chooseGroupBy(from, new Date("2026-02-01T00:00:00.000Z"), undefined)).toBe("day");
    expect(chooseGroupBy(from, new Date("2026-06-01T00:00:00.000Z"), undefined)).toBe("month");
    expect(chooseGroupBy(from, new Date("2026-06-01T00:00:00.000Z"), "day")).toBe("day");
  });
});

describe("buildPaymentReport", () => {
  it("counts approved money as received and rejected money as not accepted, on the day decided", () => {
    const report = buildPaymentReport(
      [
        proof({ amountMinor: 600_000 }),
        proof({ amountMinor: 1_200_000, planName: "Growth", transactionRef: "TX-2" }),
        proof({
          status: "REJECTED",
          amountMinor: 500_000,
          grantedMonths: null,
          rejectionReason: "wrong amount",
          reviewedAt: new Date("2026-10-05T10:00:00.000Z"),
        }),
      ],
      range,
    );
    const pkr = report.currencies[0]!;
    expect(pkr).toMatchObject({
      currency: "PKR",
      receivedMinor: 1_800_000,
      receivedCount: 2,
      rejectedMinor: 500_000,
      rejectedCount: 1,
    });
    expect(pkr.periods.find((p) => p.period === "2026-10-02")).toMatchObject({
      receivedMinor: 1_800_000,
      receivedCount: 2,
    });
    expect(pkr.periods.find((p) => p.period === "2026-10-05")).toMatchObject({
      rejectedMinor: 500_000,
    });
  });

  it("zero-fills every day of the range so a chart has no gaps", () => {
    const report = buildPaymentReport([], range);
    expect(report.currencies).toEqual([]);
    const withOne = buildPaymentReport([proof({})], range);
    expect(withOne.currencies[0]!.periods).toHaveLength(31);
    expect(withOne.currencies[0]!.periods[0]).toEqual({
      period: "2026-10-01",
      receivedMinor: 0,
      receivedCount: 0,
      rejectedMinor: 0,
      rejectedCount: 0,
    });
  });

  it("never sums across currencies", () => {
    const report = buildPaymentReport(
      [proof({ amountMinor: 600_000 }), proof({ currency: "USD", amountMinor: 1_000 })],
      range,
    );
    expect(report.currencies.map((c) => [c.currency, c.receivedMinor])).toEqual([
      ["PKR", 600_000],
      ["USD", 1_000],
    ]);
  });

  it("keeps waiting proofs out of both totals and counts them by submission date", () => {
    const report = buildPaymentReport(
      [
        proof({
          status: "PENDING",
          amountMinor: 700_000,
          reviewedAt: null,
          createdAt: new Date("2026-10-10T09:00:00.000Z"),
        }),
      ],
      range,
    );
    expect(report.currencies[0]).toMatchObject({
      receivedMinor: 0,
      rejectedMinor: 0,
      waitingMinor: 700_000,
      waitingCount: 1,
    });
  });

  it("ignores payments decided outside the range, even if submitted inside it", () => {
    const report = buildPaymentReport(
      [proof({ reviewedAt: new Date("2026-11-03T08:00:00.000Z") })],
      range,
    );
    expect(report.currencies).toEqual([]);
  });

  it("buckets by the viewer's own day: 21:00 UTC is already tomorrow in Pakistan (+5h)", () => {
    const decided = new Date("2026-10-02T21:00:00.000Z"); // 02:00 on 3 Oct in UTC+5
    const utc = buildPaymentReport([proof({ reviewedAt: decided })], range);
    expect(utc.currencies[0]!.periods.find((p) => p.receivedCount === 1)!.period).toBe(
      "2026-10-02",
    );
    const pakistan = buildPaymentReport([proof({ reviewedAt: decided })], {
      ...range,
      from: new Date("2026-09-30T19:00:00.000Z"), // 1 Oct 00:00 in UTC+5
      to: new Date("2026-10-31T19:00:00.000Z"),
      tzOffsetMinutes: 300,
    });
    expect(pakistan.currencies[0]!.periods.find((p) => p.receivedCount === 1)!.period).toBe(
      "2026-10-03",
    );
  });

  it("groups by calendar month and ranks plans by money received", () => {
    const report = buildPaymentReport(
      [
        proof({ planName: "Starter", amountMinor: 600_000 }),
        proof({ planName: "Growth", amountMinor: 1_200_000, transactionRef: "TX-2" }),
        proof({
          planName: "Starter",
          amountMinor: 600_000,
          transactionRef: "TX-3",
          reviewedAt: new Date("2026-12-10T08:00:00.000Z"),
        }),
      ],
      {
        from: new Date("2026-10-01T00:00:00.000Z"),
        to: new Date("2027-01-01T00:00:00.000Z"),
        groupBy: "month",
        tzOffsetMinutes: 0,
      },
    );
    const pkr = report.currencies[0]!;
    expect(pkr.periods.map((p) => [p.period, p.receivedMinor])).toEqual([
      ["2026-10-01", 1_800_000],
      ["2026-11-01", 0],
      ["2026-12-01", 600_000],
    ]);
    expect(pkr.byPlan).toEqual([
      { planName: "Growth", receivedMinor: 1_200_000, receivedCount: 1 },
      { planName: "Starter", receivedMinor: 1_200_000, receivedCount: 2 },
    ]);
  });
});

describe("export rows", () => {
  it("writes amounts in major units and plain status words, oldest first", () => {
    const rows = paymentExportRows(
      [
        proof({ transactionRef: "LATE", reviewedAt: new Date("2026-10-09T08:00:00.000Z") }),
        proof({
          status: "REJECTED",
          transactionRef: "EARLY",
          grantedMonths: null,
          rejectionReason: "blurry",
          reviewedAt: new Date("2026-10-03T08:00:00.000Z"),
        }),
      ],
      { from: range.from, to: range.to, tzOffsetMinutes: 0 },
    );
    expect(rows.map((r) => r.Reference)).toEqual(["EARLY", "LATE"]);
    expect(rows[0]).toMatchObject({
      Date: "2026-10-03",
      Amount: 6000,
      Currency: "PKR",
      Status: "Not accepted",
      "Rejection reason": "blurry",
    });
    expect(rows[1]).toMatchObject({ Status: "Received", "Months granted": 1 });
  });

  it("minorToMajor follows the currency's own decimals", () => {
    expect(minorToMajor(600_000, "PKR")).toBe(6000);
    expect(minorToMajor(500, "JPY")).toBe(500);
    expect(minorToMajor(1500, "KWD")).toBe(1.5);
  });

  it("the summary sheet has a total row per currency", () => {
    const report = buildPaymentReport([proof({})], range);
    const rows = summarySheetRows(report);
    expect(rows[0]).toEqual([
      "Period",
      "Currency",
      "Received",
      "Payments received",
      "Not accepted",
      "Payments rejected",
    ]);
    expect(rows[rows.length - 1]).toEqual(["Total", "PKR", 6000, 1, 0, 0]);
  });
});
