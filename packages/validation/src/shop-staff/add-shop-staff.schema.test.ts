import {
  activateStaffInviteSchema,
  addShopStaffSchema,
  acceptStaffInviteSchema,
} from "./add-shop-staff.schema.js";

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

  it("fix wave 1: activation takes the invited email, the emailed token and a new password (same rules as sign-up)", () => {
    const valid = {
      email: " Owner@Example.COM",
      token: "t".repeat(43),
      password: "a-new-password",
    };
    expect(activateStaffInviteSchema.safeParse(valid)).toMatchObject({
      success: true,
      data: { email: "owner@example.com" },
    });
    expect(activateStaffInviteSchema.safeParse({ ...valid, password: "short" }).success).toBe(
      false,
    );
    expect(activateStaffInviteSchema.safeParse({ ...valid, token: "short" }).success).toBe(false);
    expect(activateStaffInviteSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
  });
});
