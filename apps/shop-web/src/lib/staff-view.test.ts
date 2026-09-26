import { UserRole } from "@print-automated/types";
import { canActOnMember, grantableRoles, isUuid } from "./staff-view";

describe("grantableRoles", () => {
  it("offers SHOP_OWNER only to an owner", () => {
    expect(grantableRoles(UserRole.SHOP_OWNER)).toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(UserRole.SHOP_MANAGER)).not.toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(null)).not.toContain(UserRole.SHOP_OWNER);
    expect(grantableRoles(UserRole.SHOP_MANAGER)).toEqual([
      UserRole.SHOP_MANAGER,
      UserRole.SHOP_COUNTER,
      UserRole.OPERATOR,
      UserRole.PRINTER_MANAGER,
    ]);
  });
});

describe("canActOnMember", () => {
  it("keeps an owner's membership out of a manager's reach", () => {
    expect(canActOnMember(UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)).toBe(false);
    expect(canActOnMember(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER)).toBe(true);
    expect(canActOnMember(UserRole.SHOP_MANAGER, UserRole.OPERATOR)).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(isUuid(" 3f2b8c1e-9d4a-4c7e-8a55-0b6f1d2e3a4c ")).toBe(true);
    expect(isUuid("owner@example.com")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
