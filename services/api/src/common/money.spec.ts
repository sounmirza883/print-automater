import { pickCurrency } from "./money.js";

describe("pickCurrency (23.10)", () => {
  it("prefers an explicit choice, then the currency with the most money, then the fallback", () => {
    const totals = [
      { currency: "PKR", amount: 100 },
      { currency: "USD", amount: 500 },
      { currency: "PKR", amount: 200 },
    ];
    expect(pickCurrency(totals, "PKR", "PKR")).toBe("PKR");
    expect(pickCurrency(totals, undefined, "PKR")).toBe("USD");
    expect(pickCurrency([], undefined, "PKR")).toBe("PKR");
  });

  it("breaks a tie towards the configured currency, deterministically", () => {
    const tie = [
      { currency: "AED", amount: 10 },
      { currency: "PKR", amount: 10 },
    ];
    expect(pickCurrency(tie, undefined, "PKR")).toBe("PKR");
    expect(pickCurrency(tie, undefined, "EUR")).toBe("AED");
  });
});
