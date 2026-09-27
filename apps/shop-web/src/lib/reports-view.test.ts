import {
  apiParams,
  bucketLabel,
  csvFileName,
  customRangeProblem,
  formatDuration,
  labelledIndexes,
  niceTicks,
  parseReportsQuery,
  presetDates,
  rangeLabel,
  reportsSearch,
} from "./reports-view";

const NOW = new Date("2026-09-27T15:30:00.000Z");
const reader = (query: string) => new URLSearchParams(query);

describe("presetDates (UTC, inclusive, ending today)", () => {
  it("covers exactly the named number of days", () => {
    expect(presetDates("last7", NOW)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetDates("last30", NOW)).toEqual({ from: "2026-08-29", to: "2026-09-27" });
    expect(presetDates("thisMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-27" });
    expect(presetDates("last12Months", NOW)).toEqual({ from: "2025-10-01", to: "2026-09-27" });
  });
});

describe("parseReportsQuery", () => {
  it("defaults to the orders report over the last 30 days, by day", () => {
    expect(parseReportsQuery(reader(""), NOW)).toEqual({
      report: "orders",
      range: "last30",
      from: "2026-08-29",
      to: "2026-09-27",
      groupBy: "day",
      currency: "",
    });
  });

  it("reads a valid custom range and a currency", () => {
    const query = parseReportsQuery(
      reader(
        "report=revenue&range=custom&from=2026-01-01&to=2026-03-31&groupBy=month&currency=usd",
      ),
      NOW,
    );
    expect(query).toMatchObject({
      report: "revenue",
      range: "custom",
      from: "2026-01-01",
      to: "2026-03-31",
      groupBy: "month",
      currency: "USD",
    });
  });

  it("falls back to the defaults for an unknown report, a backwards or over-long range, bad dates", () => {
    expect(parseReportsQuery(reader("report=secrets"), NOW).report).toBe("orders");
    for (const bad of [
      "range=custom&from=2026-05-01&to=2026-04-01",
      "range=custom&from=2025-01-01&to=2026-06-01",
      "range=custom&from=2026-02-30&to=2026-03-01",
    ]) {
      expect(parseReportsQuery(reader(bad), NOW).range).toBe("last30");
    }
    expect(parseReportsQuery(reader("groupBy=hour&currency=$$"), NOW)).toMatchObject({
      groupBy: "day",
      currency: "",
    });
  });

  it("round-trips through the URL, leaving defaults out", () => {
    const query = parseReportsQuery(reader("report=printers&range=last90"), NOW);
    expect(reportsSearch(query)).toBe("report=printers&range=last90");
    expect(parseReportsQuery(reader(reportsSearch(query)), NOW)).toEqual(query);
  });
});

describe("apiParams", () => {
  it("makes the inclusive end date exclusive (next midnight UTC)", () => {
    const query = parseReportsQuery(reader("range=last7"), NOW);
    expect(apiParams(query)).toEqual({
      from: "2026-09-21T00:00:00.000Z",
      to: "2026-09-28T00:00:00.000Z",
      groupBy: "day",
    });
  });
});

describe("customRangeProblem", () => {
  it("accepts a usable range and explains an unusable one", () => {
    expect(customRangeProblem("2026-01-01", "2026-01-01")).toBeNull();
    expect(customRangeProblem("", "2026-01-01")).toMatch(/start and an end/);
    expect(customRangeProblem("2026-02-01", "2026-01-01")).toMatch(/on or after/);
    expect(customRangeProblem("2025-01-01", "2026-06-01")).toMatch(/at most 366/);
  });
});

describe("labels and ticks", () => {
  it("labels buckets by grouping, in UTC", () => {
    expect(bucketLabel("2026-09-21", "day")).toBe("21 Sep");
    expect(bucketLabel("2026-09-21", "week")).toBe("w/c 21 Sep");
    expect(bucketLabel("2026-09-01", "month")).toBe("Sep 2026");
    expect(rangeLabel("2026-08-29", "2026-09-27")).toBe("29 Aug – 27 Sep 2026");
    expect(rangeLabel("2025-10-01", "2026-09-27")).toBe("1 Oct 2025 – 27 Sep 2026");
  });

  it("picks clean ticks that reach the maximum", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(9)).toEqual([0, 5, 10]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(40)).toEqual([0, 10, 20, 30, 40]);
  });

  it("labels at most a few evenly spaced positions, always first and last", () => {
    expect(labelledIndexes(4)).toEqual([0, 1, 2, 3]);
    const many = labelledIndexes(90);
    expect(many[0]).toBe(0);
    expect(many.at(-1)).toBe(89);
    expect(many.length).toBeLessThanOrEqual(6);
  });

  it("fits fewer labels into a narrow chart", () => {
    expect(labelledIndexes(30, 4)).toEqual([0, 10, 19, 29]);
    expect(labelledIndexes(30, 2)).toEqual([0, 29]);
  });

  it("formats durations and file names", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(38)).toBe("38 s");
    expect(formatDuration(245)).toBe("4 min 5 s");
    expect(formatDuration(3720)).toBe("1 h 2 min");
    expect(csvFileName({ report: "revenue", from: "2026-08-29", to: "2026-09-27" })).toBe(
      "revenue-2026-08-29-to-2026-09-27.csv",
    );
  });
});
