import {
  BarChart3,
  Bell,
  Calculator,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Layers,
  Link2,
  Package,
  Printer,
  Receipt,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { FeaturePreviewKind } from "./features";

export type FeaturePageSlug =
  | "online-ordering"
  | "printer-allocation"
  | "production-queue"
  | "paper-inventory"
  | "payments-invoices"
  | "reports";

export type FeaturePage = {
  slug: FeaturePageSlug;
  /** Short name used in cards, breadcrumbs and related links. */
  name: string;
  /** Meta description and card blurb. */
  summary: string;
  headline: string;
  lede: string;
  icon: LucideIcon;
  preview: FeaturePreviewKind;
  benefits: readonly { title: string; body: string; icon: LucideIcon }[];
  steps: readonly { title: string; body: string }[];
  faqs: readonly { question: string; answer: string }[];
  related: readonly FeaturePageSlug[];
};

export const featurePages: readonly FeaturePage[] = [
  {
    slug: "online-ordering",
    name: "Online ordering",
    summary: "Customers upload a file, choose options and see the exact price before they pay.",
    headline: "Take orders online without working out a single quote",
    lede: "Give customers one link. They upload a document, choose paper, size and colour, and see the price straight away, driven by your own price list.",
    icon: ShoppingCart,
    preview: "ordering",
    benefits: [
      {
        title: "Live, exact pricing",
        body: "Every quote comes from your price list, so the number a customer sees is the number you charge.",
        icon: Calculator,
      },
      {
        title: "Details read from the file",
        body: "Page count and colour are detected from the uploaded document, so customers do not have to guess.",
        icon: FileText,
      },
      {
        title: "One shareable link",
        body: "Put your shop link on a website, a QR poster or a chat status. Customers need no setup to order.",
        icon: Link2,
      },
      {
        title: "Fewer counter arguments",
        body: "Prices are agreed before the job starts, which means fewer disputes when the customer comes to collect.",
        icon: ShieldCheck,
      },
    ],
    steps: [
      {
        title: "Set your prices",
        body: "Enter paper types, sizes, colour modes and finishing in the dashboard.",
      },
      {
        title: "Share your ordering link",
        body: "Publish the link anywhere your customers already look.",
      },
      {
        title: "Customer uploads and configures",
        body: "They upload a PDF, pick options and see the price update as they choose.",
      },
      {
        title: "Order arrives ready to work on",
        body: "Once paid, the order lands in your queue with the file, options and price attached.",
      },
    ],
    faqs: [
      {
        question: "Which file types can customers upload?",
        answer:
          "PDF is the primary supported format. Other formats may be added over time, and uploads are virus-scanned.",
      },
      {
        question: "Can I change prices later?",
        answer:
          "Yes. Update your price list and new quotes use it immediately. Orders already placed keep the price they were quoted.",
      },
      {
        question: "Do customers need an account?",
        answer:
          "Customers register or sign in so they can follow their order and get status updates.",
      },
    ],
    related: ["payments-invoices", "printer-allocation"],
  },
  {
    slug: "printer-allocation",
    name: "Printer allocation",
    summary: "Paid orders are matched to a printer that can do the job, with optional failover.",
    headline: "Let every job find a printer that can actually print it",
    lede: "Print Automated matches each paid order to a suitable printer by paper, colour support and current load, and can move work on when a printer goes offline.",
    icon: Printer,
    preview: "allocation",
    benefits: [
      {
        title: "Matched to the job",
        body: "Colour jobs go to colour printers and paper requirements are respected, so operators are not sorting jobs by hand.",
        icon: SlidersHorizontal,
      },
      {
        title: "Load-aware",
        body: "Busy printers are weighed against free ones, spreading work instead of stacking one queue.",
        icon: Gauge,
      },
      {
        title: "Optional failover",
        body: "Opt in and waiting jobs move from an offline printer to another suitable one. Otherwise they stay queued and staff are told.",
        icon: RefreshCw,
      },
      {
        title: "You stay in control",
        body: "Automation can be switched off per shop, and staff can always reassign a job themselves.",
        icon: ShieldCheck,
      },
    ],
    steps: [
      {
        title: "Install the printer agent",
        body: "Run the agent on the Windows computer beside your printers and pair it with a short code.",
      },
      {
        title: "Choose which printers to share",
        body: "Pick the printers the agent may use. It connects outward, so no ports are opened.",
      },
      {
        title: "Orders are allocated when paid",
        body: "Each paid order is matched to a printer that supports its paper and colour mode.",
      },
      {
        title: "Failover if a printer drops",
        body: "If auto-failover is on, waiting jobs move on. If not, they wait and your team is notified.",
      },
    ],
    faqs: [
      {
        question: "Which printers work?",
        answer:
          "Any printer with a Windows driver. The agent talks to the driver, so you are not tied to a brand or model.",
      },
      {
        question: "Can I turn automatic allocation off?",
        answer:
          "Yes. Automation is a per-shop setting, and staff can assign jobs manually at any time.",
      },
      {
        question: "What if no printer fits a job?",
        answer:
          "The job stays in the queue for staff to resolve rather than being sent somewhere that cannot print it.",
      },
    ],
    related: ["production-queue", "paper-inventory"],
  },
  {
    slug: "production-queue",
    name: "Production queue",
    summary: "One live queue with a clear lifecycle from received to ready for pickup.",
    headline: "One live queue, from received to ready for pickup",
    lede: "Operators see every job in one place. Each order moves through tracked statuses, and every change is recorded so nobody has to ask where a job is.",
    icon: Layers,
    preview: "queue",
    benefits: [
      {
        title: "A single source of truth",
        body: "Counter and print room look at the same queue instead of comparing notes.",
        icon: ClipboardList,
      },
      {
        title: "Tracked statuses",
        body: "Jobs move through clear statuses so the state of any order is unambiguous.",
        icon: Layers,
      },
      {
        title: "Act in one click",
        body: "Pause, retry or reassign a job without leaving the queue.",
        icon: SlidersHorizontal,
      },
      {
        title: "Customers stay informed",
        body: "Status changes reach the customer, which cuts down the number of calls to the counter.",
        icon: Bell,
      },
    ],
    steps: [
      {
        title: "Order arrives",
        body: "A paid order enters the queue with its file and options.",
      },
      {
        title: "Staff review and approve",
        body: "Counter or operators check the job before it goes to a printer.",
      },
      {
        title: "The job prints",
        body: "The printer agent runs the job and reports progress back to the queue.",
      },
      {
        title: "Ready for pickup",
        body: "Mark the order ready and the customer is told. Handover closes the order.",
      },
    ],
    faqs: [
      {
        question: "What if a print fails?",
        answer:
          "A failed job is flagged in the queue. Staff can retry it or reassign it to another printer.",
      },
      {
        question: "Is there a history of changes?",
        answer: "Yes. Status changes and sensitive actions are recorded with who made them.",
      },
    ],
    related: ["printer-allocation", "reports"],
  },
  {
    slug: "paper-inventory",
    name: "Paper inventory",
    summary: "Stock is deducted as jobs print, with reorder levels and suppliers alongside.",
    headline: "Know what paper you have before the rush order arrives",
    lede: "Stock is tracked in a ledger of every movement and deducted as jobs print. Low-stock alerts point to the supplier to call.",
    icon: Package,
    preview: "inventory",
    benefits: [
      {
        title: "Ledger of every movement",
        body: "Stock is an append-only record, so you can see where every sheet went.",
        icon: ScrollText,
      },
      {
        title: "Low-stock alerts",
        body: "Set reorder levels per paper and get warned before you run out.",
        icon: Bell,
      },
      {
        title: "Suppliers beside stock",
        body: "Keep supplier details next to the paper they provide, ready when you need to reorder.",
        icon: Truck,
      },
      {
        title: "Allocation respects stock",
        body: "Automatic allocation waits when paper runs out instead of starting a job it cannot finish.",
        icon: Package,
      },
    ],
    steps: [
      {
        title: "Add your paper types",
        body: "Create each paper with its size and weight and record the opening stock.",
      },
      {
        title: "Set reorder levels",
        body: "Choose the point at which each paper is considered low.",
      },
      {
        title: "Stock moves as jobs print",
        body: "Usage is deducted automatically, and you can record deliveries and adjustments.",
      },
      {
        title: "Reorder from the supplier",
        body: "When an alert fires, contact the supplier listed against that paper.",
      },
    ],
    faqs: [
      {
        question: "Can I correct a stock count?",
        answer:
          "Yes. Corrections are recorded as new movements rather than edits, so the history stays intact.",
      },
      {
        question: "Does it place supplier orders for me?",
        answer:
          "No. It tells you what is low and who supplies it. Placing the order is still up to you.",
      },
    ],
    related: ["printer-allocation", "reports"],
  },
  {
    slug: "payments-invoices",
    name: "Payments & invoices",
    summary: "Counter and online payments, numbered invoices, receipts and tracked refunds.",
    headline: "Take payment, issue the paperwork, keep refunds attached",
    lede: "Record payment at the counter or online, then get a numbered invoice and a receipt automatically. Refunds and balances stay linked to the order they belong to.",
    icon: CreditCard,
    preview: "payments",
    benefits: [
      {
        title: "Counter and online",
        body: "Cash, card at the counter and pay-on-pickup are supported. Online card payments are on the roadmap.",
        icon: CreditCard,
      },
      {
        title: "Numbered invoices",
        body: "An invoice is issued for each order, with line items and a clear paid status.",
        icon: FileText,
      },
      {
        title: "Printable receipts",
        body: "Hand customers a receipt at pickup without writing anything out.",
        icon: Receipt,
      },
      {
        title: "Refunds on the record",
        body: "A refund is tracked as its own process and linked to the original payment and order.",
        icon: RefreshCw,
      },
    ],
    steps: [
      {
        title: "Order is priced",
        body: "The price comes from your price list when the customer configures the order.",
      },
      {
        title: "Payment is recorded",
        body: "Customers pay online, or staff record payment at the counter.",
      },
      {
        title: "Invoice and receipt are issued",
        body: "Numbered documents are created from the order automatically.",
      },
      {
        title: "Refund if needed",
        body: "Authorised staff start a refund, which is tracked from pending to refunded.",
      },
    ],
    faqs: [
      {
        question: "Can a customer pay part now and the rest later?",
        answer: "Partial payments and outstanding balances are tracked against the order.",
      },
      {
        question: "Who can issue refunds?",
        answer:
          "Only roles that have the refund permission. Permissions are enforced on the server.",
      },
      {
        question: "Are card payments live?",
        answer: "Card payments through a provider are coming soon. Counter payments work today.",
      },
    ],
    related: ["online-ordering", "reports"],
  },
  {
    slug: "reports",
    name: "Reports & dashboards",
    summary:
      "Role-based dashboards for revenue, volume and printer utilisation, with an audit log.",
    headline: "See how the shop is doing, and only what your role allows",
    lede: "Owners see revenue and utilisation, counter staff see orders to hand over and operators see their printers. An audit log records who changed what.",
    icon: BarChart3,
    preview: "dashboards",
    benefits: [
      {
        title: "Revenue and volume",
        body: "See what came in and how many orders you handled over the period you choose.",
        icon: BarChart3,
      },
      {
        title: "Printer utilisation",
        body: "Spot printers that are overloaded or idle and adjust how you use them.",
        icon: Gauge,
      },
      {
        title: "Role-based views",
        body: "Each person's dashboard shows what their role needs and nothing more.",
        icon: Users,
      },
      {
        title: "Audit log",
        body: "Sensitive actions are recorded with who did them and when.",
        icon: ScrollText,
      },
    ],
    steps: [
      {
        title: "Invite your team",
        body: "Create accounts and give each person a role.",
      },
      {
        title: "Work as usual",
        body: "Orders, payments and printing feed the reports automatically.",
      },
      {
        title: "Open your dashboard",
        body: "Each role lands on the view that matters for their job.",
      },
      {
        title: "Review and adjust",
        body: "Use the reports and audit log to fix bottlenecks and check changes.",
      },
    ],
    faqs: [
      {
        question: "Can staff see revenue?",
        answer: "Only if their role allows it. Owners decide who sees financial reports.",
      },
      {
        question: "Can I export reports?",
        answer:
          "Ask support about current export options; this page does not promise formats that are not yet available.",
      },
    ],
    related: ["production-queue", "payments-invoices"],
  },
];

export function getFeaturePage(slug: string): FeaturePage | undefined {
  return featurePages.find((f) => f.slug === slug);
}
