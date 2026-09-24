import { periodStart } from "./page-limit-period.js";

const d = (s: string) => new Date(s);

describe("periodStart (UTC)", () => {
  it("DAILY: midnight UTC, boundaries", () => {
    expect(periodStart("DAILY", d("2026-09-24T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
    expect(periodStart("DAILY", d("2026-09-24T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
    expect(periodStart("DAILY", d("2026-09-25T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });
  it("WEEKLY: ISO week starting Monday", () => {
    // 2026-09-21 is a Monday
    expect(periodStart("WEEKLY", d("2026-09-21T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
    expect(periodStart("WEEKLY", d("2026-09-27T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
    expect(periodStart("WEEKLY", d("2026-09-28T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    expect(periodStart("WEEKLY", d("2026-09-20T12:00:00.000Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z",
    );
  });
  it("WEEKLY crosses month and year", () => {
    // 2027-01-01 is a Friday; Monday was 2026-12-28
    expect(periodStart("WEEKLY", d("2027-01-01T10:00:00.000Z")).toISOString()).toBe(
      "2026-12-28T00:00:00.000Z",
    );
  });
  it("MONTHLY: first of month, boundaries and leap February", () => {
    expect(periodStart("MONTHLY", d("2026-09-30T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(periodStart("MONTHLY", d("2026-10-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(periodStart("MONTHLY", d("2028-02-29T12:00:00.000Z")).toISOString()).toBe(
      "2028-02-01T00:00:00.000Z",
    );
    expect(periodStart("MONTHLY", d("2027-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
