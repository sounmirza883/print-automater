import {
  MAX_REPORT_DAYS,
  exportFileName,
  periodLabel,
  rangeForPreset,
  rangeFromInputs,
  rangeLabel,
  toInputDate,
  tzOffsetMinutes,
} from "./report-range";

// 15 Oct 2026, 14:30 local. Assertions use local getters, so the suite is time-zone independent.
const now = new Date(2026, 9, 15, 14, 30);
const ymd = (date: Date) => toInputDate(date);

describe("rangeForPreset", () => {
  it("today runs from this midnight to the next", () => {
    const { from, to } = rangeForPreset("today", now);
    expect([ymd(from), ymd(to)]).toEqual(["2026-10-15", "2026-10-16"]);
    expect([from.getHours(), to.getHours()]).toEqual([0, 0]);
  });

  it("this month / last month are whole calendar months", () => {
    expect(
      ["thisMonth", "lastMonth"].map((p) => {
        const r = rangeForPreset(p as "thisMonth" | "lastMonth", now);
        return [ymd(r.from), ymd(r.to)];
      }),
    ).toEqual([
      ["2026-10-01", "2026-11-01"],
      ["2026-09-01", "2026-10-01"],
    ]);
  });

  it("last N months are N calendar months ending with the current one, across a year end", () => {
    const jan = new Date(2026, 0, 20);
    const three = rangeForPreset("last3Months", jan);
    expect([ymd(three.from), ymd(three.to)]).toEqual(["2025-11-01", "2026-02-01"]);
    const twelve = rangeForPreset("last12Months", now);
    expect([ymd(twelve.from), ymd(twelve.to)]).toEqual(["2025-11-01", "2026-11-01"]);
    const six = rangeForPreset("last6Months", now);
    expect(ymd(six.from)).toBe("2026-05-01");
  });

  it("this year is 1 Jan to 1 Jan", () => {
    const { from, to } = rangeForPreset("thisYear", now);
    expect([ymd(from), ymd(to)]).toEqual(["2026-01-01", "2027-01-01"]);
  });

  it("last month in January is December of the year before", () => {
    const r = rangeForPreset("lastMonth", new Date(2026, 0, 5));
    expect([ymd(r.from), ymd(r.to)]).toEqual(["2025-12-01", "2026-01-01"]);
  });
});

describe("rangeFromInputs", () => {
  it("includes the whole end day", () => {
    const result = rangeFromInputs("2026-10-01", "2026-10-31");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([ymd(result.range.from), ymd(result.range.to)]).toEqual(["2026-10-01", "2026-11-01"]);
    }
  });

  it("allows a single day", () => {
    const result = rangeFromInputs("2026-10-05", "2026-10-05");
    expect(result.ok && ymd(result.range.to)).toBe("2026-10-06");
  });

  it("refuses missing, impossible, backwards and over-long ranges with a reason", () => {
    expect(rangeFromInputs("", "2026-10-31")).toMatchObject({ ok: false });
    expect(rangeFromInputs("2026-02-31", "2026-03-10")).toMatchObject({ ok: false });
    expect(rangeFromInputs("2026-10-31", "2026-10-01")).toEqual({
      ok: false,
      error: "The end date is before the start date.",
    });
    expect(rangeFromInputs("2010-01-01", "2026-10-01")).toEqual({
      ok: false,
      error: "A report can cover at most 5 years.",
    });
    expect(MAX_REPORT_DAYS).toBe(1830);
  });
});

describe("labels", () => {
  it("labels a range by its first and last shown day, or one day", () => {
    const r = rangeForPreset("thisMonth", now);
    expect(rangeLabel(r)).toBe("Oct 1, 2026 – Oct 31, 2026");
    expect(rangeLabel(rangeForPreset("today", now))).toBe("Oct 15, 2026");
  });

  it("names the export file by the days it covers", () => {
    expect(exportFileName(rangeForPreset("thisMonth", now), "xlsx")).toBe(
      "payments_2026-10-01_to_2026-10-31.xlsx",
    );
    expect(exportFileName(rangeForPreset("today", now), "csv")).toBe(
      "payments_2026-10-15_to_2026-10-15.csv",
    );
  });

  it("reads a period as a month or a day", () => {
    expect(periodLabel("2026-10-01", "month")).toBe("October 2026");
    expect(periodLabel("2026-10-05", "day")).toBe("Mon, Oct 5");
  });

  it("reports the viewer's offset ahead of UTC, never -0", () => {
    expect(Object.is(tzOffsetMinutes(now), -0)).toBe(false);
    expect(tzOffsetMinutes(now)).toBe(-now.getTimezoneOffset() || 0);
  });
});
