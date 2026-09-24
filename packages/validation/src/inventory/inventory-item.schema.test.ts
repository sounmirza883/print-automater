import {
  createInventoryItemSchema,
  listInventoryItemsQuerySchema,
  recordInventoryMovementSchema,
  updateInventoryItemSchema,
} from "./inventory-item.schema.js";

const shopId = "6ddee6f2-64f4-42ed-8e6e-f51691514da5";

describe("recordInventoryMovementSchema sign rules (§27)", () => {
  const ok = (v: unknown) => recordInventoryMovementSchema.safeParse(v).success;

  it("purchases and returns must add; consumption must remove; others either way", () => {
    expect(ok({ type: "PURCHASE", quantityDelta: 5 })).toBe(true);
    expect(ok({ type: "PURCHASE", quantityDelta: -5 })).toBe(false);
    expect(ok({ type: "RETURN", quantityDelta: -1 })).toBe(false);
    expect(ok({ type: "CONSUMPTION", quantityDelta: -5 })).toBe(true);
    expect(ok({ type: "CONSUMPTION", quantityDelta: 5 })).toBe(false);
    expect(ok({ type: "TRANSFER", quantityDelta: -5 })).toBe(true);
    expect(ok({ type: "TRANSFER", quantityDelta: 5 })).toBe(true);
  });

  it("refuses zero and non-integers, and demands a reason for adjustments and corrections", () => {
    expect(ok({ type: "TRANSFER", quantityDelta: 0 })).toBe(false);
    expect(ok({ type: "TRANSFER", quantityDelta: 1.5 })).toBe(false);
    expect(ok({ type: "ADJUSTMENT", quantityDelta: 1 })).toBe(false);
    expect(ok({ type: "ADJUSTMENT", quantityDelta: 1, reason: "recount" })).toBe(true);
    expect(ok({ type: "CORRECTION", quantityDelta: -1 })).toBe(false);
  });
});

describe("inventory item schemas", () => {
  it("create: max may not be below min", () => {
    expect(
      createInventoryItemSchema.safeParse({ shopId, name: "A4", minQuantity: 10, maxQuantity: 5 })
        .success,
    ).toBe(false);
    expect(
      createInventoryItemSchema.safeParse({ shopId, name: "A4", minQuantity: 10, maxQuantity: 10 })
        .success,
    ).toBe(true);
  });

  it("update: quantity is not an editable field (strict), and an empty patch is refused", () => {
    expect(updateInventoryItemSchema.safeParse({ quantity: 5 }).success).toBe(false);
    expect(updateInventoryItemSchema.safeParse({}).success).toBe(false);
    expect(updateInventoryItemSchema.safeParse({ location: null }).success).toBe(true);
  });

  it("list: pagination defaults, coercion and the page-size cap", () => {
    const parsed = listInventoryItemsQuerySchema.parse({ shopId });
    expect(parsed).toMatchObject({ limit: 50, offset: 0 });
    expect(
      listInventoryItemsQuerySchema.parse({ shopId, limit: "10", offset: "20" }),
    ).toMatchObject({ limit: 10, offset: 20 });
    expect(listInventoryItemsQuerySchema.safeParse({ shopId, limit: "101" }).success).toBe(false);
    expect(listInventoryItemsQuerySchema.safeParse({ shopId, offset: "-1" }).success).toBe(false);
    // the string "false" must mean false, not truthy
    expect(listInventoryItemsQuerySchema.parse({ shopId, lowStock: "false" }).lowStock).toBe(false);
  });
});
