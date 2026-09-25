export type Tutorial = {
  id: string;
  title: string;
  summary: string;
  /** Estimated time to complete, in minutes. */
  minutes: number;
  audience: string;
  steps: readonly { title: string; body: string }[];
};

export const tutorials: readonly Tutorial[] = [
  {
    id: "first-order",
    title: "Your first order, end to end",
    summary: "Place a test order and follow it from upload to pickup.",
    minutes: 20,
    audience: "Owners and managers setting up",
    steps: [
      {
        title: "Set a price",
        body: "In pricing settings, add one paper type and a price per page for black and white.",
      },
      {
        title: "Connect a printer",
        body: "Install the printer agent, pair it with the code from your dashboard and share one printer.",
      },
      {
        title: "Open your ordering link",
        body: "Visit your shop link the way a customer would and sign in.",
      },
      {
        title: "Upload a small PDF",
        body: "Choose the paper and options. Check the quoted price matches your list.",
      },
      {
        title: "Pay at the counter",
        body: "Back in the dashboard, record the payment on the order.",
      },
      {
        title: "Watch it print",
        body: "Follow the job in the queue as it is allocated to your printer and prints.",
      },
      {
        title: "Mark ready and hand over",
        body: "Mark the order ready for pickup, then complete the handover. Open the invoice and receipt to see what the customer gets.",
      },
    ],
  },
  {
    id: "day-at-the-counter",
    title: "Run a day at the counter",
    summary: "The rhythm of a normal day for counter staff and operators.",
    minutes: 15,
    audience: "Counter staff and operators",
    steps: [
      {
        title: "Open the dashboard",
        body: "Check printers are online and the agent computer is on before the doors open.",
      },
      {
        title: "Check paper",
        body: "Look at stock and any low-stock alerts, and load the papers you expect to use.",
      },
      {
        title: "Work the queue",
        body: "Review new orders, approve them and keep an eye on jobs as they print.",
      },
      {
        title: "Take walk-in orders",
        body: "Create the order for the customer, record payment and let it flow into the queue like any other.",
      },
      {
        title: "Hand over finished work",
        body: "Mark orders ready, find them by number at pickup and complete the handover with a receipt.",
      },
      {
        title: "Deal with problems",
        body: "Retry or reassign a failed job, and note the reason on the order.",
      },
      {
        title: "Close the day",
        body: "Check nothing is stuck in the queue, and that payments taken match what is in the till.",
      },
    ],
  },
  {
    id: "invite-your-team",
    title: "Invite your team and set roles",
    summary: "Add staff so each person sees only what they need.",
    minutes: 10,
    audience: "Owners",
    steps: [
      {
        title: "Open team settings",
        body: "Choose to add a team member.",
      },
      {
        title: "Enter their email",
        body: "They will use it to sign in.",
      },
      {
        title: "Pick a role",
        body: "Choose the smallest role that covers their work: counter, operator or manager.",
      },
      {
        title: "Check their view",
        body: "Ask them to sign in and confirm they see the screens they need.",
      },
      {
        title: "Review the audit log",
        body: "After a few days, look at the log to see who changed what.",
      },
    ],
  },
  {
    id: "first-report",
    title: "Read your first report",
    summary: "Find revenue, volume and printer utilisation after a few days of orders.",
    minutes: 10,
    audience: "Owners and managers",
    steps: [
      {
        title: "Open reports",
        body: "Pick the date range you want to review.",
      },
      {
        title: "Check revenue and volume",
        body: "See what came in and how many orders you handled.",
      },
      {
        title: "Look at printer utilisation",
        body: "Spot printers doing most of the work and any that sit idle.",
      },
      {
        title: "Act on it",
        body: "Adjust which printers are shared, reorder low paper or change staffing.",
      },
    ],
  },
];
