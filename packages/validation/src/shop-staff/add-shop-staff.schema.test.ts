import { addShopStaffSchema, acceptStaffInviteSchema } from "./add-shop-staff.schema.js";

const shopId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

describe("addShopStaffSchema (23.15)", () => {
  it("accepts exactly one of userId or email", () => {
    expect(addShopStaffSchema.safeParse({ shopId, userId, role: "OPERATOR" }).success).toBe(true);
    expect(
      addShopStaffSchema.safeParse({ shopId, email: "A@Example.COM ", role: "OPERATOR" }),
    ).toMatchObject({ success: true, data: { email: "a@example.com" } });
  });

  it("rejects both, neither, a bad address and a non-assignable role", () => {
    expect(
      addShopStaffSchema.safeParse({ shopId, userId, email: "a@b.co", role: "OPERATOR" }).success,
    ).toBe(false);
    expect(addShopStaffSchema.safeParse({ shopId, role: "OPERATOR" }).success).toBe(false);
    expect(addShopStaffSchema.safeParse({ shopId, email: "nope", role: "OPERATOR" }).success).toBe(
      false,
    );
    expect(addShopStaffSchema.safeParse({ shopId, userId, role: "ADMIN" }).success).toBe(false);
  });

  it("the accept schema needs a plausible opaque token", () => {
    expect(acceptStaffInviteSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(acceptStaffInviteSchema.safeParse({ token: "t".repeat(43) }).success).toBe(true);
  });
});
