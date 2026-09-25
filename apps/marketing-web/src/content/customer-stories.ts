export type StoryHighlight = { label: string; value: string };

export type CustomerStory = {
  id: string;
  /** Fictional shop name. */
  shop: string;
  type: string;
  location: string;
  headline: string;
  challenge: string;
  solution: string;
  result: string;
  highlights: readonly StoryHighlight[];
  /** Index into testimonials.ts to reuse the matching placeholder quote. */
  testimonialShop: string;
};

export const storiesNote =
  "These are illustrative examples about fictional shops. The figures are placeholders, not measured results from real customers.";

export const customerStories: readonly CustomerStory[] = [
  {
    id: "corner-press",
    shop: "Corner Press Co.",
    type: "Neighbourhood copy shop",
    location: "Fictional, two printers",
    headline: "From USB sticks and emails to one queue",
    challenge:
      "Files arrived by email, chat and USB, and prices were worked out at the counter by whoever was free.",
    solution:
      "Customers now use one ordering link, see the price up front and pay before printing. Jobs land in a single queue.",
    result:
      "The owner spends less time on quotes and the counter is calmer at peak hours (illustrative).",
    highlights: [
      { label: "Quote time", value: "Minutes to seconds" },
      { label: "Order channels", value: "3 to 1" },
      { label: "Pricing disputes", value: "Fewer" },
    ],
    testimonialShop: "Corner Press Co.",
  },
  {
    id: "campus-copy-hub",
    shop: "Campus Copy Hub",
    type: "University print room",
    location: "Fictional, five printers",
    headline: "Coping with exam-week rushes",
    challenge:
      "Demand spikes at deadline time, with students queuing and a printer often down or out of paper.",
    solution:
      "Students upload from their phones. Jobs are matched to printers that fit, and low-stock alerts warn staff before paper runs out.",
    result:
      "Queues at the counter shrink and fewer jobs stall waiting for a printer or paper (illustrative).",
    highlights: [
      { label: "Counter queue", value: "Shorter" },
      { label: "Paper run-outs", value: "Caught earlier" },
      { label: "Printer downtime", value: "Handled by failover" },
    ],
    testimonialShop: "Campus Copy Hub",
  },
  {
    id: "inkwell-and-sons",
    shop: "Inkwell & Sons",
    type: "Family print business",
    location: "Fictional, three printers, six staff",
    headline: "Handing the counter to new staff with confidence",
    challenge:
      "The owners were the only people trusted to change prices or handle refunds, so they could never step away.",
    solution: "Roles limit what each person can do, and the audit log records sensitive changes.",
    result:
      "New staff start taking orders sooner and the owners check the log instead of watching the counter (illustrative).",
    highlights: [
      { label: "Staff onboarding", value: "Faster" },
      { label: "Price changes", value: "Owners only" },
      { label: "Refunds", value: "Logged" },
    ],
    testimonialShop: "Inkwell & Sons",
  },
];
