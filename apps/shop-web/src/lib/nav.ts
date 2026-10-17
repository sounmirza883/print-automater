import { Permission, UserRole } from "@print-automated/types";

/** The sidebar section an entry sits under. */
export type NavGroupId =
  "overview" | "production" | "stock" | "catalogue" | "business" | "platform";

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
  /** Which sidebar section lists it. */
  group: NavGroupId;
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
    group: "overview",
    anyOf: [
      Permission.VIEW_DASHBOARD,
      Permission.VIEW_OPERATOR_DASHBOARD,
      Permission.VIEW_PRINTER_DASHBOARD,
    ],
    blurb: "Live business, production and printer status.",
  },
  {
    id: "orders",
    label: "Orders & queue",
    href: "/orders",
    scope: "business",
    group: "production",
    anyOf: [Permission.VIEW_ORDERS],
    blurb: "The production queue and every order the business has received.",
  },
  {
    id: "printers",
    label: "Printers",
    href: "/printers",
    scope: "business",
    group: "production",
    anyOf: [Permission.MANAGE_PRINTERS],
    blurb: "Register printers and manage their capabilities, limits and agents.",
  },
  {
    id: "inventory",
    label: "Inventory",
    href: "/inventory",
    scope: "business",
    group: "stock",
    anyOf: [Permission.VIEW_INVENTORY],
    blurb: "Paper stock, movements and low-stock alerts.",
  },
  {
    id: "suppliers",
    label: "Suppliers",
    href: "/suppliers",
    scope: "business",
    group: "stock",
    anyOf: [Permission.MANAGE_SUPPLIERS],
    blurb: "Supplier records and the products they provide.",
  },
  {
    id: "purchase-orders",
    label: "Purchase orders",
    href: "/purchase-orders",
    scope: "business",
    group: "stock",
    anyOf: [Permission.MANAGE_INVENTORY],
    blurb: "Restock orders, receiving and supplier payments.",
  },
  {
    id: "products",
    label: "Products & pricing",
    href: "/products",
    scope: "business",
    group: "catalogue",
    anyOf: [Permission.MANAGE_PRICES],
    blurb: "The catalogue of print products and the pricing rules behind them.",
  },
  {
    id: "customers",
    label: "Customers",
    href: "/customers",
    scope: "business",
    group: "production",
    anyOf: [Permission.CREATE_ORDERS, Permission.EDIT_ORDERS],
    blurb: "Walk-in and repeat customers for counter orders.",
  },
  {
    id: "staff",
    label: "Staff",
    href: "/staff",
    scope: "business",
    group: "business",
    anyOf: [Permission.MANAGE_USERS],
    blurb: "Who works at the business and what each person may do.",
  },
  {
    id: "branches",
    label: "Branches",
    href: "/branches",
    scope: "business",
    group: "business",
    anyOf: [Permission.MANAGE_SETTINGS],
    blurb: "The business's locations, who manages each, and which are open.",
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    scope: "business",
    group: "business",
    anyOf: [Permission.VIEW_REPORTS],
    blurb: "Orders, revenue, printing volume, printer usage, workload and purchasing.",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    scope: "business",
    group: "business",
    anyOf: [Permission.VIEW_SETTINGS],
    blurb: "Business details, automation switches and printer rules.",
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    scope: "business",
    group: "business",
    anyOf: [Permission.MANAGE_SETTINGS],
    blurb: "Pay for your plan and send proof of payment.",
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/notifications",
    scope: "any",
    group: "overview",
    anyOf: [],
    blurb: "Alerts about jobs, printers and stock.",
  },
  {
    id: "admin",
    label: "Overview",
    href: "/admin",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "Platform-wide health, businesses and security events.",
  },
  {
    id: "admin-businesses",
    label: "Businesses",
    href: "/admin/businesses",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "Every business on the platform: create one, view detail, change status.",
  },
  {
    id: "admin-users",
    label: "Users",
    href: "/admin/users",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "Every user on the platform: view detail, change role or status.",
  },
  {
    id: "admin-plans",
    label: "Plans",
    href: "/admin/plans",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "The plans businesses are put on: name, price, billing period, and who is on each.",
  },
  {
    id: "admin-payments",
    label: "Payments",
    href: "/admin/payments",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "Payment proofs from businesses: check each one, then approve or reject it.",
  },
  {
    id: "admin-reports",
    label: "Reports",
    href: "/admin/reports",
    scope: "platform",
    group: "platform",
    anyOf: [],
    blurb: "Money received and not accepted over any period, with CSV and Excel export.",
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

/** The sidebar's sections, in display order. `label: null` is the unlabelled
 * first section. */
export const NAV_GROUPS: ReadonlyArray<{ id: NavGroupId; label: string | null }> = [
  { id: "overview", label: null },
  { id: "production", label: "Production" },
  { id: "stock", label: "Stock" },
  { id: "catalogue", label: "Catalogue" },
  { id: "business", label: "Business" },
  { id: "platform", label: "Platform" },
];

export interface NavGroupView {
  id: NavGroupId;
  label: string | null;
  items: NavItem[];
}

/** The given (already permission-filtered) items arranged into sections.
 * A section with nothing in it is dropped, so no role sees an empty heading. */
export function groupedNav(items: readonly NavItem[]): NavGroupView[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);
}

export interface BottomTab {
  id: string;
  href: string;
  /** Short enough for a phone tab ("Orders & queue" does not fit). */
  label: string;
}

/** Candidates for the phone's bottom bar, most used first. */
const BOTTOM_TAB_ORDER: ReadonlyArray<{ id: string; label: string }> = [
  { id: "dashboard", label: "Home" },
  { id: "orders", label: "Orders" },
  { id: "printers", label: "Printers" },
  { id: "inventory", label: "Stock" },
  { id: "customers", label: "Customers" },
  { id: "admin", label: "Overview" },
  { id: "admin-businesses", label: "Businesses" },
  { id: "admin-payments", label: "Payments" },
  { id: "admin-users", label: "Users" },
];

const BOTTOM_TAB_LIMIT = 4;

/** Up to four tabs for the phone's bottom bar, taken in priority order from
 * what this role can see. Everything else is reached through "More". */
export function bottomTabs(items: readonly NavItem[]): BottomTab[] {
  const tabs: BottomTab[] = [];
  for (const candidate of BOTTOM_TAB_ORDER) {
    const item = items.find((entry) => entry.id === candidate.id);
    if (item !== undefined && tabs.length < BOTTOM_TAB_LIMIT) {
      tabs.push({ id: item.id, href: item.href, label: candidate.label });
    }
  }
  return tabs;
}
