export type Integration = {
  name: string;
  /** Short text monogram (no real brand logos). */
  monogram: string;
  description: string;
  status: "available" | "coming-soon";
};

export const integrations: Integration[] = [
  {
    name: "Windows print drivers",
    monogram: "WIN",
    description:
      "Works with any printer brand that has a Windows driver, through the printer agent.",
    status: "available",
  },
  {
    name: "PostgreSQL",
    monogram: "PG",
    description: "Reliable relational storage for orders, jobs, inventory and the audit trail.",
    status: "available",
  },
  {
    name: "S3-compatible storage",
    monogram: "S3",
    description: "Store uploaded files in any S3-compatible bucket you already trust.",
    status: "available",
  },
  {
    name: "Email / SMTP",
    monogram: "@",
    description: "Order confirmations and status updates through your own mail provider.",
    status: "available",
  },
  {
    name: "REST API and webhooks",
    monogram: "API",
    description: "Connect your own tools and react to order and job events as they happen.",
    status: "available",
  },
  {
    name: "Card payments",
    monogram: "PAY",
    description: "Take online card payments at checkout.",
    status: "coming-soon",
  },
  {
    name: "SMS and WhatsApp",
    monogram: "MSG",
    description: "Tell customers the moment their order is ready.",
    status: "coming-soon",
  },
  {
    name: "Push notifications",
    monogram: "PUSH",
    description: "Alert staff and customers in the mobile apps.",
    status: "coming-soon",
  },
];
