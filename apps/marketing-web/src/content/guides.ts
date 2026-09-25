import {
  CreditCard,
  Package,
  Printer,
  PrinterCheck,
  Tags,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "steps"; items: readonly string[] }
  | { type: "list"; items: readonly string[] };

export type GuideSection = {
  id: string;
  heading: string;
  blocks: readonly GuideBlock[];
};

export type Guide = {
  slug: string;
  title: string;
  summary: string;
  category: "Setup" | "Operations" | "Team" | "Payments";
  /** Estimated reading and doing time in minutes. */
  minutes: number;
  icon: LucideIcon;
  intro: string;
  sections: readonly GuideSection[];
  related: readonly string[];
};

export const guides: readonly Guide[] = [
  {
    slug: "setting-up-pricing-rules",
    title: "Setting up pricing rules",
    summary: "Enter your price list once so every online quote matches what you would charge.",
    category: "Setup",
    minutes: 10,
    icon: Tags,
    intro:
      "Live quotes are only as good as your price list. This guide covers what to enter, in what order, and how to check the result before customers see it.",
    sections: [
      {
        id: "what-you-need",
        heading: "What to have ready",
        blocks: [
          {
            type: "list",
            items: [
              "The paper types and sizes you sell, for example A4 80gsm or A3 100gsm",
              "Your per-page price for black and white and for colour",
              "Any finishing you offer, such as binding, and what it costs",
            ],
          },
        ],
      },
      {
        id: "enter-prices",
        heading: "Enter the price list",
        blocks: [
          {
            type: "steps",
            items: [
              "Open the pricing settings in your shop dashboard.",
              "Add each paper type and size you sell.",
              "Set the price per page for each colour mode.",
              "Add finishing options with their prices.",
              "Save. New quotes use the updated list straight away.",
            ],
          },
          {
            type: "p",
            text: "Orders that were already quoted keep the price the customer saw, so changing your list never alters an order that is in progress.",
          },
        ],
      },
      {
        id: "test-a-quote",
        heading: "Check it with a test order",
        blocks: [
          {
            type: "p",
            text: "Open your shop ordering link, upload a small PDF and choose a few different options. Compare the quote with what you would work out by hand. Fix any gap in the price list, then repeat until they match.",
          },
        ],
      },
      {
        id: "tips",
        heading: "Tips",
        blocks: [
          {
            type: "list",
            items: [
              "Start with your most common jobs and add the unusual ones later.",
              "Review prices when your paper supplier changes theirs.",
              "Only owners and managers should be allowed to change prices. See the roles and permissions guide.",
            ],
          },
        ],
      },
    ],
    related: ["managing-paper-stock", "roles-and-permissions"],
  },
  {
    slug: "connecting-your-first-printer",
    title: "Connecting your first printer",
    summary:
      "Install the printer agent, pair it with your shop and choose which printers to share.",
    category: "Setup",
    minutes: 15,
    icon: Printer,
    intro:
      "Print Automated talks to your printers through a small agent that runs on a Windows computer in your shop. It connects outward, so you do not open any ports.",
    sections: [
      {
        id: "before-you-start",
        heading: "Before you start",
        blocks: [
          {
            type: "list",
            items: [
              "A Windows computer that is on during opening hours and can reach the printers",
              "The printer driver installed, so the printer already prints from that computer",
              "An owner or manager login for your shop",
            ],
          },
          {
            type: "p",
            text: "Any printer that has a Windows driver can be used. You are not tied to a particular brand or model.",
          },
        ],
      },
      {
        id: "install-and-pair",
        heading: "Install and pair the agent",
        blocks: [
          {
            type: "steps",
            items: [
              "In the shop dashboard, start adding a printer agent to get a short pairing code.",
              "Install the agent on the Windows computer and open it.",
              "Enter the pairing code when asked and sign in.",
              "The agent appears as connected in your dashboard.",
            ],
          },
        ],
      },
      {
        id: "share-printers",
        heading: "Choose which printers to share",
        blocks: [
          {
            type: "steps",
            items: [
              "Pick the printers on that computer that Print Automated may use.",
              "Tell the system what each printer supports: colour or black and white, and the paper sizes loaded.",
              "Save. Allocation only sends work a printer can actually do.",
            ],
          },
        ],
      },
      {
        id: "test-print",
        heading: "Run a test order",
        blocks: [
          {
            type: "p",
            text: "Place a small order through your ordering link, mark it paid at the counter and watch it move through the queue to the printer. Most shops complete this on the first day.",
          },
        ],
      },
    ],
    related: ["handling-a-printer-going-offline", "setting-up-pricing-rules"],
  },
  {
    slug: "handling-a-printer-going-offline",
    title: "Handling a printer going offline",
    summary: "What happens to waiting jobs, what staff see and how to recover.",
    category: "Operations",
    minutes: 6,
    icon: PrinterCheck,
    intro:
      "Printers jam, run out of toner and lose power. This guide explains how the system behaves so nothing is lost and staff know what to do.",
    sections: [
      {
        id: "what-happens",
        heading: "What the system does",
        blocks: [
          {
            type: "p",
            text: "The printer agent reports in regularly. If a printer stops reporting, it is shown as offline in the dashboard and no new work is allocated to it.",
          },
          {
            type: "list",
            items: [
              "With auto-failover on, jobs waiting for that printer move to another suitable printer.",
              "With auto-failover off, jobs stay queued and staff are told, so nothing is lost.",
              "If no other printer can do the job, it stays in the queue for a person to resolve.",
            ],
          },
          {
            type: "p",
            text: "The agent avoids running the same job twice when it reconnects.",
          },
        ],
      },
      {
        id: "what-to-do",
        heading: "What staff should do",
        blocks: [
          {
            type: "steps",
            items: [
              "Check the printer: paper, toner, jams, power and network cable.",
              "Check the agent computer is on and the agent is running.",
              "Once the printer reports again, it returns to service on its own.",
              "If a job was mid-print when it stopped, open it in the queue and retry or reassign it.",
            ],
          },
        ],
      },
      {
        id: "failover-setting",
        heading: "Deciding on auto-failover",
        blocks: [
          {
            type: "p",
            text: "Failover suits shops with several similar printers. If your printers differ a lot, or you prefer to review moves yourself, leave it off. It is a per-shop setting and can be changed at any time.",
          },
        ],
      },
    ],
    related: ["connecting-your-first-printer", "managing-paper-stock"],
  },
  {
    slug: "managing-paper-stock",
    title: "Managing paper stock",
    summary: "Add papers, set reorder levels, record deliveries and act on low-stock alerts.",
    category: "Operations",
    minutes: 8,
    icon: Package,
    intro:
      "Stock is tracked as a ledger of movements. Jobs deduct paper as they print, and you record deliveries and corrections, so the count stays trustworthy.",
    sections: [
      {
        id: "add-papers",
        heading: "Add your paper types",
        blocks: [
          {
            type: "steps",
            items: [
              "Open inventory in the dashboard and add each paper with its size and weight.",
              "Record the opening quantity from a physical count.",
              "Set a reorder level: the quantity at which you want a warning.",
              "Add the supplier for that paper so the contact is next to the stock.",
            ],
          },
        ],
      },
      {
        id: "day-to-day",
        heading: "Day to day",
        blocks: [
          {
            type: "list",
            items: [
              "Printing deducts paper automatically.",
              "Record a delivery when new stock arrives.",
              "Record an adjustment for waste or a miscount. It is added as a new movement, so the history stays intact.",
            ],
          },
          {
            type: "p",
            text: "If a paper runs out, automatic allocation waits rather than starting jobs it cannot finish.",
          },
        ],
      },
      {
        id: "low-stock",
        heading: "When a low-stock alert fires",
        blocks: [
          {
            type: "p",
            text: "Open the alert to see the paper and its supplier, then contact the supplier. Print Automated does not place the order for you.",
          },
        ],
      },
    ],
    related: ["setting-up-pricing-rules", "handling-a-printer-going-offline"],
  },
  {
    slug: "roles-and-permissions",
    title: "Roles and permissions",
    summary: "Give each person the access their job needs, and nothing more.",
    category: "Team",
    minutes: 7,
    icon: UserCog,
    intro:
      "Access is role-based and enforced on the server, not just hidden in the interface. Give people the smallest role that lets them do their work.",
    sections: [
      {
        id: "how-roles-work",
        heading: "How roles work",
        blocks: [
          {
            type: "p",
            text: "Every action is checked against the person's role and against their shop. Someone in one shop can never see another shop's data.",
          },
          {
            type: "list",
            items: [
              "Owners run the shop, including settings and financial reports.",
              "Managers oversee daily operations.",
              "Counter staff take orders, record payments and hand over finished work.",
              "Operators watch the queue and their printers.",
            ],
          },
          {
            type: "p",
            text: "Roles carry granular permissions. Check the role list in your dashboard for the exact permissions each one includes.",
          },
        ],
      },
      {
        id: "invite",
        heading: "Invite a team member",
        blocks: [
          {
            type: "steps",
            items: [
              "Open team settings and choose to add a person.",
              "Enter their email and pick a role.",
              "They sign in and see only the screens their role allows.",
              "To change access later, edit their role. When someone leaves, remove their access.",
            ],
          },
        ],
      },
      {
        id: "audit",
        heading: "Checking who did what",
        blocks: [
          {
            type: "p",
            text: "Sensitive actions such as price changes and refunds are recorded in the audit log with the person and the time.",
          },
        ],
      },
    ],
    related: ["refunds-and-reprints", "setting-up-pricing-rules"],
  },
  {
    slug: "refunds-and-reprints",
    title: "Refunds and reprints",
    summary: "How a refund is tracked, and how to handle a print that came out wrong.",
    category: "Payments",
    minutes: 6,
    icon: CreditCard,
    intro:
      "Things go wrong: a wrong print, a missing page, a customer who changes their mind. Keeping the correction on the order keeps your records honest.",
    sections: [
      {
        id: "refunds",
        heading: "Issuing a refund",
        blocks: [
          {
            type: "p",
            text: "A refund is linked to the original payment and order and has its own progress: it starts as pending and becomes refunded. If it fails, it is marked as failed so it does not disappear.",
          },
          {
            type: "steps",
            items: [
              "Open the order and review its payment.",
              "Start a refund. Only roles with the refund permission can do this.",
              "Follow it from pending to refunded, and retry or follow up if it fails.",
            ],
          },
        ],
      },
      {
        id: "reprints",
        heading: "When a print is wrong",
        blocks: [
          {
            type: "p",
            text: "A dedicated reprint action that records the original job, the reason and who requested it is planned, and is not described here as available today. Until then, use the queue to retry or reassign the job when the failure was technical.",
          },
          {
            type: "list",
            items: [
              "Note the reason on the order so the history explains what happened.",
              "If the customer should not pay for the mistake, refund the affected amount.",
              "Check the printer and paper before rerunning, so the fault does not repeat.",
            ],
          },
        ],
      },
      {
        id: "tips",
        heading: "Tips",
        blocks: [
          {
            type: "p",
            text: "Keep refunds limited to owners and managers, and review the audit log now and then to see who issued them.",
          },
        ],
      },
    ],
    related: ["roles-and-permissions", "handling-a-printer-going-offline"],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}
