import { Permission, UserRole } from "@print-automated/types";
import { serverPermissionsFor } from "@/components/test-role-permissions";
import { BACK_OFFICE_ROLES, isBackOfficeRole, membershipPermissions } from "./permissions";

describe("membershipPermissions (23.15: the list comes from /staff/me)", () => {
  it("is exactly the membership's own list, e.g. an operator's VIEW_PRINTERS", () => {
    const operator = {
      id: "shop-1",
      name: "Mock Print Co",
      role: UserRole.OPERATOR,
      permissions: serverPermissionsFor(UserRole.OPERATOR),
    };
    const permissions = membershipPermissions(operator);
    expect([...permissions].sort()).toEqual([...operator.permissions].sort());
    expect(permissions.has(Permission.VIEW_PRINTERS)).toBe(true);
    expect(permissions.has(Permission.MANAGE_PRINTERS)).toBe(false);
  });

  it("fails closed: no membership, or a membership without a list, grants nothing", () => {
    expect(membershipPermissions(null).size).toBe(0);
    expect(membershipPermissions(undefined).size).toBe(0);
    expect(membershipPermissions({}).size).toBe(0);
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
});
