import { formatMoney, summarizeConfiguration } from "./order-formatting.js";

describe("summarizeConfiguration", () => {
  it("renders plain language for an 'all pages' configuration", () => {
    const summary = summarizeConfiguration({
      pages: { mode: "all" },
      copies: 2,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
    });
    expect(summary).toBe("2 copies, all pages, A4, Black & white, Single-sided");
  });

  it("renders a page range and singular 'copy'", () => {
    const summary = summarizeConfiguration({
      pages: { mode: "range", from: 3, to: 7 },
      copies: 1,
      paperSize: "A4",
      color: "COLOR",
      sides: "DOUBLE",
    });
    expect(summary).toBe("1 copy, pages 3-7, A4, Color, Double-sided");
  });
});

describe("formatMoney", () => {
  it("formats integer minor units as a two-decimal amount", () => {
    expect(formatMoney(20000, "PKR")).toBe("PKR 200.00");
    expect(formatMoney(150, "PKR")).toBe("PKR 1.50");
  });
});
