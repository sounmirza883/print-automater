export type PostBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string; id: string }
  | { type: "ul"; items: readonly string[] };

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO
  readMinutes: number;
  author: string;
  tag: string;
  body: readonly PostBlock[];
};

export const PLACEHOLDER_LABEL =
  "Placeholder article: this is sample content for the launch site and will be replaced by a reviewed post.";

export const blogPosts: readonly BlogPost[] = [
  {
    slug: "how-automatic-printer-failover-works",
    title: "How automatic printer failover works",
    excerpt:
      "When a printer jams or goes offline mid-shift, what should happen to the jobs waiting on it? A look at recovery, failover and why you stay in control.",
    date: "2026-09-18",
    readMinutes: 5,
    author: "[Author placeholder]",
    tag: "Product",
    body: [
      {
        type: "p",
        text: "Every print shop has a story about the printer that stopped at the worst moment: a queue of urgent orders, a paper jam, and a customer at the counter. The problem is rarely the jam itself. It is what happens to the work waiting behind it.",
      },
      { type: "h2", id: "recovery-first", text: "Recovery comes first" },
      {
        type: "p",
        text: "Before any job moves anywhere, the system has to know what state it is in. A job that was interrupted is recovered instead of forgotten. If the system cannot be sure whether a job finished printing, it does not guess, because guessing means a double print or a missing one. It marks the job as uncertain and asks a person.",
      },
      { type: "h2", id: "failover-is-opt-in", text: "Failover is opt-in" },
      {
        type: "p",
        text: "Moving a job to a different printer is a decision with consequences: paper size, colour capability and cost per page all differ. For that reason, failover is something a shop turns on, not something that happens behind its back.",
      },
      {
        type: "ul",
        items: [
          "The job must be compatible with the new printer's paper and colour capability.",
          "The move is recorded in the audit log so you can see what happened and why.",
          "You can switch automatic movement off and handle it by hand at any time.",
        ],
      },
      { type: "h2", id: "the-agent", text: "The agent never opens your network" },
      {
        type: "p",
        text: "The printer agent connects outward to the platform and asks for authorised work. Nothing needs to reach into your network, so a failover decision never requires exposing a printer to the internet.",
      },
    ],
  },
  {
    slug: "from-whatsapp-files-to-a-real-print-queue",
    title: "From WhatsApp files to a real print queue",
    excerpt:
      "Files in chat threads, prices from memory, jobs on sticky notes. Here is what changes when orders arrive in one place.",
    date: "2026-09-08",
    readMinutes: 4,
    author: "[Author placeholder]",
    tag: "Guides",
    body: [
      {
        type: "p",
        text: "Many small print shops start the same way: the customer sends a file in a chat, the owner replies with a price, and someone prints it when they get a moment. It is friendly and fast, and it does not scale past a handful of orders a day.",
      },
      { type: "h2", id: "where-it-breaks", text: "Where the chat approach breaks" },
      {
        type: "ul",
        items: [
          "Files get buried, compressed or sent twice, and nobody is sure which is the latest.",
          "Prices depend on who is at the counter.",
          "There is no single view of what is waiting, what is printing and what is ready.",
          "A customer's document sits on a personal phone.",
        ],
      },
      { type: "h2", id: "one-place", text: "One place for the whole order" },
      {
        type: "p",
        text: "With an online order form, the customer uploads the file, chooses pages, paper and colour, and sees a price calculated from the shop's own rules. The file is checked for malware, kept private, and attached to an order with a clear status.",
      },
      { type: "h2", id: "queue", text: "A queue the shop can trust" },
      {
        type: "p",
        text: "Jobs enter a production queue and are matched to a printer that can actually produce them. Staff see the same list, and the customer sees the same status. You do not have to change everything at once: many shops start by taking orders online and keep assigning printers by hand until they trust the automation.",
      },
    ],
  },
  {
    slug: "what-a-print-shop-should-automate-and-what-it-shouldnt",
    title: "What a print shop should automate, and what it shouldn't",
    excerpt:
      "Automation is a lever, not a goal. A practical way to decide which parts of your shop to hand to software and which to keep human.",
    date: "2026-08-27",
    readMinutes: 6,
    author: "[Author placeholder]",
    tag: "Operations",
    body: [
      {
        type: "p",
        text: "It is tempting to automate everything the moment you can. In a print shop, the better question is which decisions are routine enough to be safe for software and which ones carry judgement.",
      },
      { type: "h2", id: "good-candidates", text: "Good candidates for automation" },
      {
        type: "ul",
        items: [
          "Price calculation from your own rate card.",
          "Checking that a file is valid and free of malware.",
          "Matching a job to a printer that supports its paper and colour needs.",
          "Tracking paper stock and warning you before it runs out.",
          "Status updates to customers.",
        ],
      },
      { type: "h2", id: "keep-human", text: "Keep a person in the loop" },
      {
        type: "ul",
        items: [
          "Accepting unusual or high-value orders.",
          "Discounts, refunds and exceptions.",
          "Anything the system is unsure about, such as a job whose print state is unknown.",
          "Quality checks before handover.",
        ],
      },
      { type: "h2", id: "switches", text: "Every automation needs an off switch" },
      {
        type: "p",
        text: "Shops differ, and trust builds slowly. Good automation can be turned on one piece at a time, explains what it did, and can be switched off without breaking the rest. Start with the routine work, watch the audit trail for a few weeks, and widen the scope when it earns your confidence.",
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
