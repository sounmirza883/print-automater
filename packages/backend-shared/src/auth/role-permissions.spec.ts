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

  it("pause/resume (21.1): held by the production roles (same set as ASSIGN_JOBS), never SHOP_COUNTER or customers", () => {
    for (const role of ["OPERATOR", "PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("PAUSE_JOBS");
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("PAUSE_JOBS");
    expect(ROLE_PERMISSIONS.CUSTOMER).not.toContain("PAUSE_JOBS");
  });

  it("inventory (20.2): operators and printer managers may view, only manager/owner may manage, counter neither", () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.PRINTER_MANAGER).toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain("MANAGE_INVENTORY");
    expect(ROLE_PERMISSIONS.PRINTER_MANAGER).not.toContain("MANAGE_INVENTORY");
    for (const role of ["SHOP_MANAGER", "SHOP_OWNER"] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain("VIEW_INVENTORY");
      expect(ROLE_PERMISSIONS[role]).toContain("MANAGE_INVENTORY");
    }
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("VIEW_INVENTORY");
    expect(ROLE_PERMISSIONS.SHOP_COUNTER).not.toContain("MANAGE_INVENTORY");
    // every role that can manage can also view (a manage-only role could not see what it edits)
    for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
      if (ROLE_PERMISSIONS[role].includes("MANAGE_INVENTORY")) {
        expect(ROLE_PERMISSIONS[role]).toContain("VIEW_INVENTORY");
      }
    }
  });
});
