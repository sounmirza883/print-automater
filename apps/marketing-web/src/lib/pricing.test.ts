import { annualSavings, annualTotal, monthlyPrice } from "./pricing";

describe("pricing helpers", () => {
  it("returns the list price on the monthly cycle", () => {
    expect(monthlyPrice(49, "monthly")).toBe(49);
  });

  it("discounts the effective monthly price on the annual cycle", () => {
    expect(monthlyPrice(120, "annual")).toBe(100);
    expect(monthlyPrice(49, "annual")).toBe(41);
  });

  it("computes annual total and savings", () => {
    expect(annualTotal(120)).toBe(1200);
    expect(annualSavings(120)).toBe(240);
  });
});
