export type FaqCategory = "Product" | "Pricing" | "Security" | "Setup" | "Support" | "Integrations";

export type FaqItem = { id: string; category: FaqCategory; question: string; answer: string };

export const faqs: FaqItem[] = [
  {
    id: "what-is-it",
    category: "Product",
    question: "What is Print Automated?",
    answer:
      "It is an operating system for print shops. Customers order online, jobs are routed to the right printer automatically, and your staff track everything from upload to pickup in one place.",
  },
  {
    id: "which-printers",
    category: "Integrations",
    question: "Which printers does it work with?",
    answer:
      "Any printer that has a Windows driver. A small printer agent on the shop computer talks to the driver, so you are not tied to one brand or model.",
  },
  {
    id: "printer-agent",
    category: "Setup",
    question: "How does the printer agent get set up?",
    answer:
      "Install the agent on a Windows computer in your shop, sign in and pick which printers to share. It connects outward to Print Automated, so you do not open any ports on your network.",
  },
  {
    id: "going-live",
    category: "Setup",
    question: "How long does it take to go live?",
    answer:
      "Most shops connect their first printer and take a test order the same day. Adding prices, paper types and staff accounts is done from the dashboard.",
  },
  {
    id: "pricing-plans",
    category: "Pricing",
    question: "How is pricing structured?",
    answer:
      "Plans scale with printers, staff users and monthly orders. The figures on this page are placeholders, and annual billing is shown with two months free.",
  },
  {
    id: "data-safety",
    category: "Security",
    question: "How is my shop and customer data protected?",
    answer:
      "Data is encrypted in transit and at rest, each shop is isolated from every other, uploads are virus-scanned and access is role-based with an audit log of sensitive actions.",
  },
  {
    id: "printer-down",
    category: "Product",
    question: "What happens if a printer goes offline?",
    answer:
      "If you opt in to auto-failover, waiting jobs move to another suitable printer. Otherwise they stay queued and staff are told, so nothing is lost.",
  },
  {
    id: "integrations-api",
    category: "Integrations",
    question: "Can I connect my own tools?",
    answer:
      "Yes. A REST API and webhooks let you read orders and react to job events. Card payments, SMS/WhatsApp and push notifications are coming soon.",
  },
  {
    id: "support-help",
    category: "Support",
    question: "How do I get help?",
    answer:
      "Documentation and guides cover most questions, and you can email support at any time. Business plans include a dedicated contact.",
  },
];
