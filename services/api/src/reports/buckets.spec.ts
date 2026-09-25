import { bucketKeys, bucketStart } from "./buckets.js";

const d = (iso: string): Date => new Date(iso);

describe("report buckets (23.5)", () => {
  it("day: truncates to 00:00 UTC and lists every day in the range", () => {
    expect(bucketStart(d("2026-03-05T23:59:59Z"), "day")).toBe("2026-03-05");
    expect(bucketKeys(d("2026-03-05T10:00:00Z"), d("2026-03-08T01:00:00Z"), "day")).toEqual([
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
  });

  it("week: starts on Monday (ISO), like Postgres date_trunc('week')", () => {
    // 2026-03-05 is a Thursday -> week of Monday 2026-03-02
    expect(bucketStart(d("2026-03-05T12:00:00Z"), "week")).toBe("2026-03-02");
    expect(bucketStart(d("2026-03-08T23:00:00Z"), "week")).toBe("2026-03-02"); // Sunday
    expect(bucketStart(d("2026-03-09T00:00:00Z"), "week")).toBe("2026-03-09");
    expect(bucketKeys(d("2026-03-05T00:00:00Z"), d("2026-03-17T00:00:00Z"), "week")).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
    ]);
  });

  it("month: starts on the 1st and crosses year ends", () => {
    expect(bucketStart(d("2026-03-31T23:00:00Z"), "month")).toBe("2026-03-01");
    expect(bucketKeys(d("2025-11-20T00:00:00Z"), d("2026-02-02T00:00:00Z"), "month")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
  });

  it("a single-instant range yields exactly one bucket", () => {
    expect(bucketKeys(d("2026-03-05T10:00:00Z"), d("2026-03-05T10:00:00Z"), "day")).toEqual([
      "2026-03-05",
    ]);
  });
});
