import { UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS } from "./role-permissions.js";

describe("ROLE_PERMISSIONS (§47/16.2)", () => {
  it("has an entry for every UserRole, even if empty", () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it("gives CUSTOMER and SUPPLIER no shop-side permissions", () => {
    expect(ROLE_PERMISSIONS.CUSTOMER).toEqual([]);
    expect(ROLE_PERMISSIONS.SUPPLIER).toEqual([]);
  });

  it("gives SHOP_OWNER strictly more than SHOP_MANAGER (MANAGE_SETTINGS)", () => {
    const owner = new Set(ROLE_PERMISSIONS.SHOP_OWNER);
    const manager = new Set(ROLE_PERMISSIONS.SHOP_MANAGER);
    for (const permission of manager) {
      expect(owner.has(permission)).toBe(true);
    }
    expect(owner.size).toBeGreaterThan(manager.size);
  });

  it("never grants SHOP_COUNTER MANAGE_PRINTERS or MANAGE_USERS", () => {
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_PRINTERS");
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_USERS");
  });
});
