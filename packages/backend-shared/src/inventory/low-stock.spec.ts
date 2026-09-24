import { isLowStock } from "./low-stock.js";

describe("isLowStock (§32)", () => {
  it("is low once quantity reaches the minimum (inclusive)", () => {
    expect(isLowStock(101, 100)).toBe(false);
    expect(isLowStock(100, 100)).toBe(true);
    expect(isLowStock(0, 100)).toBe(true);
  });

  it("a minimum of zero means no alert is configured, so it is never low", () => {
    expect(isLowStock(0, 0)).toBe(false);
    expect(isLowStock(5, 0)).toBe(false);
  });
});
