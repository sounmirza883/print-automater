import type { PrinterCandidate } from "../print-jobs/allocate-printer.js";
import {
  paperItemMatches,
  paperNeedFor,
  sheetsForJob,
  withPaperAvailability,
  type PaperNeed,
} from "./paper-availability.js";

describe("sheetsForJob (one measure for the paper gate and consumption)", () => {
  it("single-sided: one sheet per page, times copies", () => {
    expect(sheetsForJob("SINGLE", { pagesPerCopy: 5, copies: 3 })).toBe(15);
  });

  it("double-sided: two pages per sheet, rounded UP per copy, times copies", () => {
    expect(sheetsForJob("DOUBLE", { pagesPerCopy: 5, copies: 3 })).toBe(9);
    expect(sheetsForJob("DOUBLE", { pagesPerCopy: 4, copies: 2 })).toBe(4);
    expect(sheetsForJob("DOUBLE", { pagesPerCopy: 1, copies: 1 })).toBe(1);
  });
});

describe("paperNeedFor", () => {
  it("carries the size, the effective type (absent means STANDARD, per PrintConfiguration) and the sheets", () => {
    const config = {
      pages: { mode: "all" as const },
      copies: 2,
      paperSize: "A4" as const,
      color: "BW" as const,
      sides: "DOUBLE" as const,
      orientation: "PORTRAIT" as const,
    };
    expect(paperNeedFor(config, { pagesPerCopy: 5, copies: 2, total: 10 })).toEqual({
      paperSize: "A4",
      paperType: "STANDARD",
      sheets: 6,
    });
    expect(
      paperNeedFor({ ...config, paperType: "PHOTO" }, { pagesPerCopy: 5, copies: 2, total: 10 })
        .paperType,
    ).toBe("PHOTO");
  });
});

describe("paperItemMatches (the single matching rule)", () => {
  const need: PaperNeed = { paperSize: "A4", paperType: "STANDARD", sheets: 1 };
  const item = (over: Partial<Parameters<typeof paperItemMatches>[0]>) => ({
    active: true,
    paperSize: "A4",
    paperType: "STANDARD" as string | null,
    ...over,
  });

  it("matches size and type, treats an untyped item as any type, and ignores inactive items", () => {
    expect(paperItemMatches(item({}), need)).toBe(true);
    expect(paperItemMatches(item({ paperType: null }), need)).toBe(true);
    expect(paperItemMatches(item({ paperType: "PREMIUM" }), need)).toBe(false);
    expect(paperItemMatches(item({ paperSize: "A3" }), need)).toBe(false);
    expect(paperItemMatches(item({ paperSize: null }), need)).toBe(false);
    expect(paperItemMatches(item({ active: false }), need)).toBe(false);
  });
});

describe("withPaperAvailability", () => {
  const candidate = (id: string): PrinterCandidate => ({
    id,
    status: "ONLINE",
    hasAgent: true,
    capabilities: null,
    supportedSizes: [],
    supportedPaperTypes: [],
    maxJobPages: null,
    queuedPages: 0,
    queuedJobs: 0,
    registeredAt: 0,
  });
  const need: PaperNeed = { paperSize: "A4", paperType: "STANDARD", sheets: 5 };
  const db = (enabled: boolean, stock: number) =>
    ({
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ enabled }])
        .mockResolvedValueOnce([{ total: stock }]),
    }) as never;

  it("tracking disabled: returns the SAME array untouched (no paperAvailable set: flag-off behaviour is unchanged)", async () => {
    const list = [candidate("a")];
    const result = await withPaperAvailability(db(false, 0), "shop", list, need);
    expect(result).toBe(list);
    expect(result[0]).not.toHaveProperty("paperAvailable");
  });

  it("tracking enabled: paperAvailable is stock >= sheets on every candidate", async () => {
    const list = [candidate("a"), candidate("b")];
    const enough = await withPaperAvailability(db(true, 5), "shop", list, need);
    expect(enough.map((c) => c.paperAvailable)).toEqual([true, true]);
    const short = await withPaperAvailability(db(true, 4), "shop", list, need);
    expect(short.map((c) => c.paperAvailable)).toEqual([false, false]);
    // the input candidates are not mutated
    expect(list[0]).not.toHaveProperty("paperAvailable");
  });
});
