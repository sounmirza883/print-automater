import { consumptionOrder } from "./consume-paper.js";

describe("consumptionOrder", () => {
  it("draws the exactly-typed item first, then untyped; ties by most stock then id", () => {
    const items = [
      { id: "c", quantity: 50, paperType: null },
      { id: "b", quantity: 10, paperType: "STANDARD" },
      { id: "a", quantity: 10, paperType: "STANDARD" },
      { id: "d", quantity: 99, paperType: null },
      { id: "e", quantity: 500, paperType: "STANDARD" },
    ];
    expect(consumptionOrder(items, { paperType: "STANDARD" }).map((i) => i.id)).toEqual([
      "e",
      "a",
      "b",
      "d",
      "c",
    ]);
  });
});
