import { Permission, UserRole } from "@print-automated/types";
// The real, server-side table. Imported by path (not by package name) so
// shop-web never depends on backend-shared at runtime; only this test does.
import { ROLE_PERMISSIONS as SERVER_ROLE_PERMISSIONS } from "../../../../packages/backend-shared/src/auth/role-permissions";
import {
  BACK_OFFICE_ROLES,
  ROLE_PERMISSIONS,
  isBackOfficeRole,
  permissionsForRole,
} from "./permissions";

describe("ROLE_PERMISSIONS mirror", () => {
  it("has exactly the same permissions as the server's table for every role", () => {
    for (const role of Object.values(UserRole)) {
      expect([...ROLE_PERMISSIONS[role]].sort()).toEqual([...SERVER_ROLE_PERMISSIONS[role]].sort());
    }
  });

  it("covers every role (a new UserRole must be added to the mirror)", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(Object.values(UserRole).sort());
  });
});

describe("back-office roles", () => {
  it("lets staff and admins in and keeps customers and suppliers out", () => {
    expect(isBackOfficeRole("SHOP_OWNER")).toBe(true);
    expect(isBackOfficeRole("ADMIN")).toBe(true);
    expect(isBackOfficeRole("CUSTOMER")).toBe(false);
    expect(isBackOfficeRole("SUPPLIER")).toBe(false);
    expect(isBackOfficeRole("nonsense")).toBe(false);
    expect(BACK_OFFICE_ROLES).not.toContain(UserRole.CUSTOMER);
  });

  it("gives no permissions to a missing role", () => {
    expect(permissionsForRole(null).size).toBe(0);
    expect(permissionsForRole(UserRole.SHOP_COUNTER).has(Permission.VIEW_REPORTS)).toBe(false);
  });
});
