import { UserRole } from "@print-automated/types";
import {
  activeNavItem,
  bottomTabs,
  groupedNav,
  visibleNavItems,
  NAV_GROUPS,
  NAV_ITEMS,
  type NavItem,
} from "./nav";
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

  it("shows a platform admin the platform section (with its businesses/users/plans links) and notifications only", () => {
    expect(idsFor(UserRole.ADMIN, null)).toEqual([
      "notifications",
      "admin",
      "admin-businesses",
      "admin-users",
      "admin-plans",
      "admin-payments",
      "admin-reports",
    ]);
  });

  it("never shows Plans or Payments to business staff, owners included", () => {
    for (const role of [UserRole.SHOP_OWNER, UserRole.SHOP_MANAGER, UserRole.OPERATOR]) {
      expect(idsFor(role, role)).not.toContain("admin-plans");
      expect(idsFor(role, role)).not.toContain("admin-payments");
      expect(idsFor(role, role)).not.toContain("admin-reports");
    }
  });

  it("shows Billing to the business owner only -- paying for the plan is not for managers or staff", () => {
    expect(idsFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER)).toContain("billing");
    for (const role of [
      UserRole.SHOP_MANAGER,
      UserRole.SHOP_COUNTER,
      UserRole.OPERATOR,
      UserRole.PRINTER_MANAGER,
    ]) {
      expect(idsFor(role, role)).not.toContain("billing");
    }
    // A platform admin has no single business, so no Billing either.
    expect(idsFor(UserRole.ADMIN, null)).not.toContain("billing");
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
    expect(activeNavItem("/admin/plans", NAV_ITEMS)?.id).toBe("admin-plans");
    expect(activeNavItem("/admin", NAV_ITEMS)?.id).toBe("admin");
  });
});

function visibleFor(userRole: UserRole, businessRole: UserRole | null): NavItem[] {
  return visibleNavItems({
    userRole,
    businessRole,
    permissions: new Set(businessRole ? serverPermissionsFor(businessRole) : []),
  });
}

function shape(items: NavItem[]): Array<[string | null, string[]]> {
  return groupedNav(items).map((group) => [group.label, group.items.map((item) => item.id)]);
}

describe("groupedNav", () => {
  it("arranges an owner's screens under the business headings, in order", () => {
    expect(shape(visibleFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER))).toEqual([
      [null, ["dashboard", "notifications"]],
      ["Production", ["orders", "printers", "customers"]],
      ["Stock", ["inventory", "suppliers", "purchase-orders"]],
      ["Catalogue", ["products"]],
      ["Business", ["staff", "branches", "reports", "settings", "billing"]],
    ]);
  });

  it("keeps Branches to owners: a manager has no business settings access", () => {
    const business = shape(visibleFor(UserRole.SHOP_MANAGER, UserRole.SHOP_MANAGER)).find(
      ([heading]) => heading === "Business",
    );
    expect(business?.[1]).not.toContain("branches");
  });

  it("drops a heading when the role sees none of its screens", () => {
    expect(shape(visibleFor(UserRole.SHOP_COUNTER, UserRole.SHOP_COUNTER))).toEqual([
      [null, ["notifications"]],
      ["Production", ["orders", "customers"]],
    ]);
  });

  it("gives a platform admin the Platform heading and nothing business-scoped", () => {
    expect(shape(visibleFor(UserRole.ADMIN, null))).toEqual([
      [null, ["notifications"]],
      [
        "Platform",
        [
          "admin",
          "admin-businesses",
          "admin-users",
          "admin-plans",
          "admin-payments",
          "admin-reports",
        ],
      ],
    ]);
  });

  it("puts every nav item in exactly one known group", () => {
    const known = NAV_GROUPS.map((group) => group.id);
    for (const item of NAV_ITEMS) {
      expect(known).toContain(item.group);
    }
    expect(groupedNav(NAV_ITEMS).flatMap((group) => group.items)).toHaveLength(NAV_ITEMS.length);
  });

  it("is empty when there is nothing to show", () => {
    expect(groupedNav([])).toEqual([]);
  });
});

describe("bottomTabs", () => {
  it("gives an owner the four busiest screens under short labels", () => {
    expect(bottomTabs(visibleFor(UserRole.SHOP_OWNER, UserRole.SHOP_OWNER))).toEqual([
      { id: "dashboard", href: "/dashboard", label: "Home" },
      { id: "orders", href: "/orders", label: "Orders" },
      { id: "printers", href: "/printers", label: "Printers" },
      { id: "inventory", href: "/inventory", label: "Stock" },
    ]);
  });

  it("fills only from what the role can see, even if that is two tabs", () => {
    expect(
      bottomTabs(visibleFor(UserRole.SHOP_COUNTER, UserRole.SHOP_COUNTER)).map((tab) => tab.id),
    ).toEqual(["orders", "customers"]);
  });

  it("gives a platform admin the platform screens", () => {
    expect(bottomTabs(visibleFor(UserRole.ADMIN, null)).map((tab) => tab.id)).toEqual([
      "admin",
      "admin-businesses",
      "admin-payments",
      "admin-users",
    ]);
  });

  it("never returns more than four, and nothing for nothing", () => {
    expect(bottomTabs(NAV_ITEMS)).toHaveLength(4);
    expect(bottomTabs([])).toEqual([]);
  });
});
