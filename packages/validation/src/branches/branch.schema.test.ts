import { createBranchSchema, updateBranchSchema } from "./branch.schema.js";

const shopId = "0b0cf1a4-6f44-4d4e-8f0a-3f2f2c1d9a11";

/** A business's first branch is created from the business's own name, address and phone, so a
 * branch must accept everything a business accepts, or editing it later would fail on a field
 * nobody touched. */
describe("branch field limits match the business's", () => {
  it("accepts a 200-character name, a 500-character address and a 50-character phone", () => {
    const body = { name: "n".repeat(200), address: "a".repeat(500), phone: "9".repeat(50) };
    expect(createBranchSchema.safeParse({ shopId, ...body }).success).toBe(true);
    expect(updateBranchSchema.safeParse(body).success).toBe(true);
  });

  it("refuses anything longer", () => {
    expect(
      createBranchSchema.safeParse({ shopId, name: "n".repeat(201), address: "a" }).success,
    ).toBe(false);
    expect(
      createBranchSchema.safeParse({ shopId, name: "n", address: "a".repeat(501) }).success,
    ).toBe(false);
    expect(
      createBranchSchema.safeParse({ shopId, name: "n", address: "a", phone: "9".repeat(51) })
        .success,
    ).toBe(false);
  });

  it("needs at least one field to change", () => {
    expect(updateBranchSchema.safeParse({}).success).toBe(false);
  });
});
