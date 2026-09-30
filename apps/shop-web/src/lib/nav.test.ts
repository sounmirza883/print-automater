import { UserRole } from "@print-automated/types";
import { activeNavItem, visibleNavItems, NAV_ITEMS } from "./nav";
import { serverPermissionsFor } from "@/components/test-role-permissions";

function idsFor(userRole: UserRole, businessRole: UserRole | null): string[] {
  return visibleNavItems({
    userRole,
    businessRole,
    permissions: new Set(businessRole ? serverPermissionsFor(businessRole) : []),
  }).map((item) => item.id);
}

describe("visibleNavItems", () => {
  it("shows an owner every business section and no platform section", () => {
    const ids = idsFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER);
    expect(ids).toEqual(
      NAV_ITEMS.filter((item) => item.scope !== "platform").map((item) => item.id),
    );
  });

  it("limits counter staff to orders, customers and notifications", () => {
    expect(idsFor(UserRole.SHOP_COUNTER, UserRole.SHOP_COUNTER)).toEqual([
      "orders",
      "customers",
      "notifications",
    ]);
  });

  it("gives an operator the production view but no money, pricing or people screens", () => {
    const ids = idsFor(UserRole.OPERATOR, UserRole.OPERATOR);
    expect(ids).toEqual(expect.arrayContaining(["dashboard", "orders", "inventory"]));
    for (const hidden of [
      "reports",
      "staff",
      "settings",
      "products",
      "suppliers",
      "purchase-orders",
    ]) {
      expect(ids).not.toContain(hidden);
    }
  });

  it("decides by the role AT the selected business, not the account role", () => {
    // Account says owner, but at this business they are only an operator.
    const ids = idsFor(UserRole.SHOP_OWNER, UserRole.OPERATOR);
    expect(ids).not.toContain("reports");
    expect(ids).not.toContain("settings");
  });

  it("shows a platform admin the platform section (with its businesses/users links) and notifications only", () => {
    expect(idsFor(UserRole.ADMIN, null)).toEqual([
      "notifications",
      "admin",
      "admin-businesses",
      "admin-users",
    ]);
  });

  it("shows nothing business-scoped without a selected business", () => {
    expect(idsFor(UserRole.SHOP_OWNER, null)).toEqual(["notifications"]);
  });
});

describe("activeNavItem", () => {
  it("matches the section by its longest path prefix", () => {
    expect(activeNavItem("/orders/abc", NAV_ITEMS)?.id).toBe("orders");
    expect(activeNavItem("/purchase-orders/1", NAV_ITEMS)?.id).toBe("purchase-orders");
    expect(activeNavItem("/ordersx", NAV_ITEMS)).toBeUndefined();
  });

  it("picks the more specific platform sub-section over the general Platform link", () => {
    expect(activeNavItem("/admin/businesses/abc", NAV_ITEMS)?.id).toBe("admin-businesses");
    expect(activeNavItem("/admin/users/abc", NAV_ITEMS)?.id).toBe("admin-users");
    expect(activeNavItem("/admin", NAV_ITEMS)?.id).toBe("admin");
  });
});
