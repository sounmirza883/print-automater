export interface CatalogFeature {
  key: string;
  section: string;
  label: string;
  showOnCard: boolean;
  cardText?: string;
}

export interface CatalogPlan {
  name: string;
  description: string;
  priceMinor: number;
  annualPriceMinor: number | null;
  currency: string;
  billingPeriodDays: number;
  highlighted: boolean;
  contactOnly: boolean;
  /** feature key -> "true" | "false" | text */
  values: Record<string, string>;
}

/** The launch pricing table (owner-supplied 2026-10-11). Loaded once by `prisma:seed-plans`;
 * after that the admin panel owns it. Order here is display order (sort_order = index * 10). */
export const FEATURE_CATALOG: CatalogFeature[] = [
  {
    key: "printers",
    section: "Capacity",
    label: "Printers",
    showOnCard: true,
    cardText: "{value} printers",
  },
  {
    key: "staff",
    section: "Capacity",
    label: "Staff users",
    showOnCard: true,
    cardText: "{value} staff users",
  },
  {
    key: "orders",
    section: "Capacity",
    label: "Orders per month",
    showOnCard: true,
    cardText: "{value} orders per month",
  },
  { key: "routing", section: "Automation", label: "Automatic printer routing", showOnCard: true },
  {
    key: "allocation",
    section: "Automation",
    label: "Smart allocation and auto-failover",
    showOnCard: true,
  },
  { key: "rules", section: "Automation", label: "Custom automation rules", showOnCard: true },
  {
    key: "daily",
    section: "Reporting",
    label: "Daily reports",
    showOnCard: true,
    cardText: "Essential daily reports",
  },
  {
    key: "revenue",
    section: "Reporting",
    label: "Inventory and revenue reports",
    showOnCard: true,
  },
  { key: "exports", section: "Reporting", label: "Data exports and API access", showOnCard: true },
  { key: "audit", section: "Reporting", label: "Audit log", showOnCard: false },
  { key: "support", section: "Support", label: "Support", showOnCard: false },
];

const T = "true";
const F = "false";

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    name: "Starter",
    description: "For a single-counter shop getting its first orders online.",
    priceMinor: 600_000,
    annualPriceMinor: 6_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: false,
    values: {
      printers: "2",
      staff: "3",
      orders: "300",
      routing: T,
      allocation: F,
      rules: F,
      daily: T,
      revenue: F,
      exports: F,
      audit: F,
      support: "Email",
    },
  },
  {
    name: "Growth",
    description: "For busy shops that want the queue to run itself.",
    priceMinor: 1_100_000,
    annualPriceMinor: 11_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: true,
    contactOnly: false,
    values: {
      printers: "10",
      staff: "15",
      orders: "2,000",
      routing: T,
      allocation: T,
      rules: F,
      daily: T,
      revenue: T,
      exports: F,
      audit: T,
      support: "Priority email",
    },
  },
  {
    name: "Business",
    description: "For multi-site operations with heavier volume.",
    priceMinor: 1_500_000,
    annualPriceMinor: 15_000_000,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: false,
    values: {
      printers: "Unlimited",
      staff: "Unlimited",
      orders: "10,000",
      routing: T,
      allocation: T,
      rules: T,
      daily: T,
      revenue: T,
      exports: T,
      audit: T,
      support: "Dedicated contact",
    },
  },
  {
    name: "Enterprise",
    description:
      "Everything tailored to your business: limits, features and support. Talk to our team.",
    priceMinor: 0,
    annualPriceMinor: null,
    currency: "PKR",
    billingPeriodDays: 30,
    highlighted: false,
    contactOnly: true,
    values: Object.fromEntries(FEATURE_CATALOG.map((feature) => [feature.key, "Custom"])),
  },
];
