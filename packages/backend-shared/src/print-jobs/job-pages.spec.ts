import { jobPages } from "./job-pages.js";

const all = { pages: { mode: "all" as const }, copies: 1 };

describe("jobPages (resolved pages x copies)", () => {
  it("whole document x item quantity", () => {
    expect(jobPages(all, 7, 3)).toEqual({ pagesPerCopy: 7, copies: 3, total: 21 });
  });
  it("a 5-of-100 range counts 5 per copy, not 100", () => {
    const cfg = { pages: { mode: "range" as const, from: 10, to: 14 }, copies: 2 };
    expect(jobPages(cfg, 100, 2)).toEqual({ pagesPerCopy: 5, copies: 2, total: 10 });
  });
  it("no item quantity (legacy job) falls back to the configuration's copies", () => {
    expect(jobPages({ pages: { mode: "all" }, copies: 4 }, 3, undefined)).toEqual({
      pagesPerCopy: 3,
      copies: 4,
      total: 12,
    });
  });
  it("unknown document page count counts as 1; invalid range falls back to the whole document", () => {
    expect(jobPages(all, null, 2).total).toBe(2);
    const bad = { pages: { mode: "range" as const, from: 9, to: 2 }, copies: 1 };
    expect(jobPages(bad, 10, 1).pagesPerCopy).toBe(10);
  });
});
