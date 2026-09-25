export type DocsPage = {
  title: string;
  href: string;
  description: string;
};

export type DocsGroup = {
  title: string;
  pages: readonly DocsPage[];
};

export const docsHome: DocsPage = {
  title: "Overview",
  href: "/docs",
  description: "Where to start, and how the documentation is organised.",
};

export const docsGroups: readonly DocsGroup[] = [
  {
    title: "Get started",
    pages: [
      {
        title: "Getting started",
        href: "/docs/getting-started",
        description: "Set up your business, set prices, pair a printer and take your first order.",
      },
      {
        title: "Printer agent",
        href: "/docs/printer-agent",
        description: "Install the Windows agent, pair it with a code and keep it running.",
      },
    ],
  },
  {
    title: "Concepts",
    pages: [
      {
        title: "Order lifecycle",
        href: "/docs/order-lifecycle",
        description: "Order, payment and print-job statuses and how an order moves between them.",
      },
      {
        title: "Roles and permissions",
        href: "/docs/roles-and-permissions",
        description: "What each staff role can see and do.",
      },
      {
        title: "Pricing rules",
        href: "/docs/pricing-rules",
        description: "How the quote engine turns a print configuration into a price.",
      },
    ],
  },
  {
    title: "Developers",
    pages: [
      {
        title: "API reference",
        href: "/docs/api-reference",
        description: "Authentication, errors, and the REST endpoints that exist today.",
      },
      {
        title: "Webhooks",
        href: "/docs/webhooks",
        description: "Inbound payment webhooks today; outbound event webhooks are planned.",
      },
    ],
  },
];

/** Every page in reading order, starting with the overview. */
export const docsPages: readonly DocsPage[] = [docsHome, ...docsGroups.flatMap((g) => g.pages)];

export function getPrevNext(href: string): { prev: DocsPage | null; next: DocsPage | null } {
  const i = docsPages.findIndex((p) => p.href === href);
  if (i === -1) return { prev: null, next: null };
  return { prev: docsPages[i - 1] ?? null, next: docsPages[i + 1] ?? null };
}
