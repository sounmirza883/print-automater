import { Permission } from "@print-automated/types";
import { rolesWithPermission } from "./staff-notifications.js";

describe("rolesWithPermission (23.7): who staff alerts fan out to", () => {
  it("VIEW_INVENTORY reaches the floor and management, never the counter or a platform admin", () => {
    expect(rolesWithPermission(Permission.VIEW_INVENTORY).sort()).toEqual(
      ["OPERATOR", "PRINTER_MANAGER", "SHOP_MANAGER", "SHOP_OWNER"].sort(),
    );
  });

  it("ASSIGN_JOBS (blocked / held / failed print jobs) excludes the counter", () => {
    const roles = rolesWithPermission(Permission.ASSIGN_JOBS);
    expect(roles).toEqual(expect.arrayContaining(["OPERATOR", "SHOP_OWNER"]));
    expect(roles).not.toContain("SHOP_COUNTER");
    expect(roles).not.toContain("ADMIN");
    expect(roles).not.toContain("CUSTOMER");
  });
});
