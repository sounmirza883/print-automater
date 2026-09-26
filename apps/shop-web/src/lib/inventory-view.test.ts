import {
  buildItemInput,
  checkMovement,
  emptyItemForm,
  stockLabel,
  stockTone,
} from "./inventory-view";

describe("checkMovement", () => {
  it("mirrors the API's sign and reason rules", () => {
    expect(checkMovement("PURCHASE", "50", "")).toEqual({
      ok: true,
      input: { type: "PURCHASE", quantityDelta: 50, reason: undefined },
    });
    expect(checkMovement("PURCHASE", "-5", "").ok).toBe(false);
    expect(checkMovement("RETURN", "-1", "").ok).toBe(false);
    expect(checkMovement("ADJUSTMENT", "-30", "").ok).toBe(false);
    expect(checkMovement("ADJUSTMENT", "-30", "damaged in a flood")).toMatchObject({
      ok: true,
      input: { quantityDelta: -30, reason: "damaged in a flood" },
    });
  });

  it("rejects zero, decimals and junk", () => {
    for (const bad of ["0", "1.5", "abc", "", " "]) {
      expect(checkMovement("CORRECTION", bad, "why").ok).toBe(false);
    }
  });
});

describe("buildItemInput", () => {
  const form = {
    ...emptyItemForm(),
    name: "A4 80gsm",
    sku: "A4-80",
    paperSize: "A4",
    weightGsm: "80",
    minQuantity: "500",
    maxQuantity: "5000",
    unitCost: "1.25",
    initialQuantity: "2000",
  };

  it("builds a create body that leaves blanks out and an update body that clears them", () => {
    const built = buildItemInput({ ...form, location: "" }, "PKR");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.create).toMatchObject({
        name: "A4 80gsm",
        sku: "A4-80",
        weightGsm: 80,
        unitCostMinor: 125,
        initialQuantity: 2000,
      });
      expect(built.create.location).toBeUndefined();
      expect(built.update.location).toBeNull();
      expect(built.update.unitCostMinor).toBe(125);
    }
  });

  it("explains each invalid field", () => {
    const built = buildItemInput(
      { ...form, name: " ", minQuantity: "x", weightGsm: "0", unitCost: "1.999" },
      "PKR",
    );
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(Object.keys(built.errors).sort()).toEqual([
        "minQuantity",
        "name",
        "unitCost",
        "weightGsm",
      ]);
    }
  });

  it("rejects a maximum below the minimum before the API does", () => {
    const built = buildItemInput({ ...form, minQuantity: "100", maxQuantity: "50" }, "PKR");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.errors.maxQuantity).toMatch(/below the minimum/);
  });
});

describe("stock labels", () => {
  it("grades stock and never colours an inactive item", () => {
    expect(stockLabel({ quantity: 0, lowStock: true, active: true })).toBe("Out of stock");
    expect(stockLabel({ quantity: 5, lowStock: true, active: true })).toBe("Low stock");
    expect(stockLabel({ quantity: 500, lowStock: false, active: true })).toBe("In stock");
    expect(stockLabel({ quantity: 0, lowStock: true, active: false })).toBe("Inactive");
    expect(stockTone({ quantity: 0, lowStock: true, active: false })).toBe("neutral");
    expect(stockTone({ quantity: 0, lowStock: true, active: true })).toBe("danger");
  });
});
