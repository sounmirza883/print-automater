import { Permission, UserRole } from "@print-automated/types";

/** One entry of the console's navigation. `anyOf` empty = always shown
 * to a signed-in user; otherwise shown when the effective role holds at
 * least one listed permission. `scope` says whether the entry needs a
 * selected business ("business"), is platform-level ("platform"), or
 * works either way ("any"). */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  scope: "business" | "platform" | "any";
  anyOf: readonly Permission[];
  /** One line shown on screens that are not built yet. */
  blurb: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    scope: "business",
    anyOf: [
      Permission.VIEW_DASHBOARD,
      Permission.VIEW_OPERATOR_DASHBOARD,
      Permission.VIEW_PRINTER_DASHBOARD,
    ],
    blurb: "Live business, production and printer status.",
  },
  {
    id: "orders",
    label: "Orders / Queue",
    href: "/orders",
    scope: "business",
    anyOf: [Permission.VIEW_ORDERS],
    blurb: "The production queue and every order the business has received.",
  },
  {
    id: "printers",
    label: "Printers",
    href: "/printers",
    scope: "business",
    anyOf: [Permission.MANAGE_PRINTERS],
    blurb: "Register printers and manage their capabilities, limits and agents.",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/inventory",
    scope: "business",
    anyOf: [Permission.VIEW_INVENTORY],
    blurb: "Paper stock, movements and low-stock alerts.",
  },
  {
    id: "suppliers",
    label: "Suppliers",
    href: "/suppliers",
    scope: "business",
    anyOf: [Permission.MANAGE_SUPPLIERS],
    blurb: "Supplier records and the products they provide.",
  },
  {
    id: "purchase-orders",
    label: "Purchase orders",
    href: "/purchase-orders",
    scope: "business",
    anyOf: [Permission.MANAGE_INVENTORY],
    blurb: "Restock orders, receiving and supplier payments.",
  },
  {
    id: "products",
    label: "Products & pricing",
    href: "/products",
    scope: "business",
    anyOf: [Permission.MANAGE_PRICES],
    blurb: "The catalogue of print products and the pricing rules behind them.",
  },
  {
    id: "customers",
    label: "Customers",
    href: "/customers",
    scope: "business",
    anyOf: [Permission.CREATE_ORDERS, Permission.EDIT_ORDERS],
    blurb: "Walk-in and repeat customers for counter orders.",
  },
  {
    id: "staff",
    label: "Staff",
    href: "/staff",
    scope: "business",
    anyOf: [Permission.MANAGE_USERS],
    blurb: "Who works at the business and what each person may do.",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    scope: "business",
    anyOf: [Permission.VIEW_REPORTS],
    blurb: "Orders, revenue, printing volume, printer usage, workload and purchasing.",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    scope: "business",
    anyOf: [Permission.VIEW_SETTINGS],
    blurb: "Business details, automation switches and printer rules.",
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    scope: "business",
    anyOf: [Permission.MANAGE_SETTINGS],
    blurb: "Pay for your plan and send proof of payment.",
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/notifications",
    scope: "any",
    anyOf: [],
    blurb: "Alerts about jobs, printers and stock.",
  },
  {
    id: "admin",
    label: "Platform",
    href: "/admin",
    scope: "platform",
    anyOf: [],
    blurb: "Platform-wide health, businesses and security events.",
  },
  {
    id: "admin-businesses",
    label: "Businesses",
    href: "/admin/businesses",
    scope: "platform",
    anyOf: [],
    blurb: "Every business on the platform: create one, view detail, change status.",
  },
  {
    id: "admin-users",
    label: "Users",
    href: "/admin/users",
    scope: "platform",
    anyOf: [],
    blurb: "Every user on the platform: view detail, change role or status.",
  },
  {
    id: "admin-plans",
    label: "Plans",
    href: "/admin/plans",
    scope: "platform",
    anyOf: [],
    blurb: "The plans businesses are put on: name, price, billing period, and who is on each.",
  },
  {
    id: "admin-payments",
    label: "Payments",
    href: "/admin/payments",
    scope: "platform",
    anyOf: [],
    blurb: "Payment proofs from businesses: check each one, then approve or reject it.",
  },
];

export interface NavContext {
  userRole: UserRole;
  /** Effective role at the selected business, null when none is selected. */
  businessRole: UserRole | null;
  permissions: ReadonlySet<Permission>;
}

/** The items to render for this caller. A pure function of role data so
 * it is unit-tested; the server is still the gate for every request. */
export function visibleNavItems(ctx: NavContext): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.scope === "platform") {
      return ctx.userRole === UserRole.ADMIN;
    }
    if (item.scope === "business" && ctx.businessRole === null) {
      return false;
    }
    if (item.anyOf.length === 0) {
      return true;
    }
    return item.anyOf.some((permission) => ctx.permissions.has(permission));
  });
}

/** The nav item a pathname belongs to (longest matching prefix). */
export function activeNavItem(pathname: string, items: readonly NavItem[]): NavItem | undefined {
  return [...items]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
