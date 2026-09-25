export type PlanId = "starter" | "growth" | "business";

export type PlanValue = boolean | string;

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Placeholder list price per month (USD). */
  monthly: number;
  highlighted?: boolean;
  cta: string;
  features: string[];
};

export type ComparisonRow = { label: string; values: Record<PlanId, PlanValue> };
export type ComparisonGroup = { group: string; rows: ComparisonRow[] };

export const pricingNote =
  "Placeholder pricing for illustration. Final plans and prices will be confirmed at launch.";

export const plans: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For a single-counter shop getting its first orders online.",
    monthly: 49,
    cta: "Start free trial",
    features: [
      "Up to 2 printers",
      "3 staff users",
      "300 orders per month",
      "Automatic printer routing",
      "Essential daily reports",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    tagline: "For busy shops that want the queue to run itself.",
    monthly: 129,
    highlighted: true,
    cta: "Start free trial",
    features: [
      "Up to 10 printers",
      "15 staff users",
      "2,000 orders per month",
      "Smart allocation and auto-failover",
      "Inventory and revenue reports",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "For multi-site operations with heavier volume.",
    monthly: 299,
    cta: "Talk to us",
    features: [
      "Unlimited printers",
      "Unlimited staff users",
      "10,000 orders per month",
      "Custom automation rules",
      "Exports, API access and audit log",
    ],
  },
];

export const comparison: ComparisonGroup[] = [
  {
    group: "Capacity",
    rows: [
      { label: "Printers", values: { starter: "2", growth: "10", business: "Unlimited" } },
      { label: "Staff users", values: { starter: "3", growth: "15", business: "Unlimited" } },
      {
        label: "Orders per month",
        values: { starter: "300", growth: "2,000", business: "10,000" },
      },
    ],
  },
  {
    group: "Automation",
    rows: [
      {
        label: "Automatic printer routing",
        values: { starter: true, growth: true, business: true },
      },
      {
        label: "Smart allocation and auto-failover",
        values: { starter: false, growth: true, business: true },
      },
      {
        label: "Custom automation rules",
        values: { starter: false, growth: false, business: true },
      },
    ],
  },
  {
    group: "Reporting",
    rows: [
      { label: "Daily reports", values: { starter: true, growth: true, business: true } },
      {
        label: "Inventory and revenue reports",
        values: { starter: false, growth: true, business: true },
      },
      {
        label: "Data exports and API access",
        values: { starter: false, growth: false, business: true },
      },
      { label: "Audit log", values: { starter: false, growth: true, business: true } },
    ],
  },
  {
    group: "Support",
    rows: [
      {
        label: "Support",
        values: { starter: "Email", growth: "Priority email", business: "Dedicated contact" },
      },
    ],
  },
];
