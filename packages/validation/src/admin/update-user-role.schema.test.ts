import { UserRole } from "@print-automated/types";
import { updateUserRoleSchema } from "./update-user-role.schema.js";

describe("updateUserRoleSchema", () => {
  it.each(Object.values(UserRole).filter((role) => role !== UserRole.SYSTEM))(
    "accepts %s",
    (role) => {
      expect(updateUserRoleSchema.safeParse({ role }).success).toBe(true);
    },
  );

  it("rejects SYSTEM -- a synthetic QR-order account role, never assignable (24.1)", () => {
    expect(updateUserRoleSchema.safeParse({ role: UserRole.SYSTEM }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(updateUserRoleSchema.safeParse({ role: "SUPER_ADMIN" }).success).toBe(false);
  });
});
