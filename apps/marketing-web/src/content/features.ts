import {
  BarChart3,
  CreditCard,
  Layers,
  Package,
  Printer,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export type FeaturePreviewKind =
  "ordering" | "allocation" | "queue" | "inventory" | "payments" | "dashboards";

export type Feature = {
  id: string;
  name: string;
  description: string;
  bullets: readonly string[];
  icon: LucideIcon;
  href: string;
  preview: FeaturePreviewKind;
};

export const features: readonly Feature[] = [
  {
    id: "ordering",
    name: "Online ordering & live pricing",
    description:
      "Customers upload a file, pick paper, size, colour and finishing, and see the exact price before they pay. No more quotes worked out on a calculator.",
    bullets: [
      "Pages and colour are detected from the uploaded file",
      "Your price list drives every quote, instantly",
      "One shareable ordering link per shop",
    ],
    icon: ShoppingCart,
    href: "/features/online-ordering",
    preview: "ordering",
  },
  {
    id: "allocation",
    name: "Automatic printer allocation & failover",
    description:
      "Every paid order is matched to a printer that can actually do the job: right paper, right colour mode, not busy. If a printer drops offline, its jobs move on.",
    bullets: [
      "Matches by paper, colour support and current load",
      "Failover re-routes work from offline printers",
      "Automation can be switched off per shop",
    ],
    icon: Printer,
    href: "/features/printer-allocation",
    preview: "allocation",
  },
  {
    id: "queue",
    name: "Production queue & job lifecycle",
    description:
      "Operators see one live queue. Each job moves through clear statuses from received to ready for pickup, and every change is recorded.",
    bullets: [
      "14 tracked order statuses, start to finish",
      "Pause, retry or reassign a job in one click",
      "Customers get status updates without calling",
    ],
    icon: Layers,
    href: "/features/production-queue",
    preview: "queue",
  },
  {
    id: "inventory",
    name: "Paper inventory & suppliers",
    description:
      "Stock is deducted as jobs print, so you know what is left before a rush order arrives. Low-stock alerts point to the supplier to call.",
    bullets: [
      "Append-only ledger of every stock movement",
      "Automatic allocation waits when paper runs out",
      "Suppliers and reorder levels kept beside stock",
    ],
    icon: Package,
    href: "/features/paper-inventory",
    preview: "inventory",
  },
  {
    id: "payments",
    name: "Payments, invoices & receipts",
    description:
      "Take payment at the counter or online, then issue a numbered invoice and a receipt automatically. Refunds and balances stay attached to the order.",
    bullets: [
      "Cash, card at counter and pay-on-pickup",
      "Numbered invoices and printable receipts",
      "Partial payments and refunds tracked per order",
    ],
    icon: CreditCard,
    href: "/features/payments-invoices",
    preview: "payments",
  },
  {
    id: "dashboards",
    name: "Role-based dashboards & reports",
    description:
      "Owners see revenue and utilisation. Counter staff see orders to hand over. Operators see their printers. Everyone gets only what their role allows.",
    bullets: [
      "8 roles with granular permissions",
      "Revenue, volume and printer utilisation reports",
      "Audit log of who changed what",
    ],
    icon: BarChart3,
    href: "/features/reports",
    preview: "dashboards",
  },
];
