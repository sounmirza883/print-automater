export const mission =
  "Give every print shop the software a big operation would have, without the complexity.";

export const story = [
  "Print shops run on a patchwork: files arriving over WhatsApp and email, prices quoted from memory, jobs walked from desk to printer, paper counted by eye. It works until the shop gets busy, and then it breaks in small, expensive ways.",
  "Print Automated started from a simple idea: the customer uploads a file and chooses options, the price is calculated from the shop's own rules, and the job goes to the right printer. Staff stay in control of what matters, and the software handles the rest.",
  "[Founder story and founding date to be written before launch.]",
];

export const principles = [
  {
    title: "Automate the routine, keep people in charge",
    body: "Anything repetitive should run itself. Anything that affects money, customers or quality should stay a human decision, and every automatic path can be switched off.",
  },
  {
    title: "Never lose a job",
    body: "Printers jam and networks drop. Jobs are recovered, not forgotten, and uncertain states are shown to a person instead of guessed.",
  },
  {
    title: "Customer files are private",
    body: "Documents are encrypted, scanned and shared only with the shop that prints them, through short-lived links.",
  },
  {
    title: "Simple enough for the counter",
    body: "A new staff member should be productive on day one. Complexity belongs behind settings, not in front of the operator.",
  },
];

export const values = [
  { title: "Plain language", body: "We write for shop owners, not for engineers." },
  { title: "Honest claims", body: "We say what the product does today and label what is planned." },
  { title: "Reliability first", body: "A boring, dependable queue beats a clever feature." },
  {
    title: "Respect for craft",
    body: "Print is a skilled trade. Our software adapts to shops, not the other way round.",
  },
];

export type TimelineStatus = "Built" | "In progress" | "Planned";
export type TimelineItem = { status: TimelineStatus; title: string; body: string };

export const timeline: TimelineItem[] = [
  {
    status: "Built",
    title: "Online ordering and payment",
    body: "Customers upload a PDF, choose print options, see a price and pay. Orders are tracked from submission to collection.",
  },
  {
    status: "Built",
    title: "Shop mobile app and Windows printer agent",
    body: "Shops accept orders and follow the queue on mobile. The agent connects outward and prints authorised jobs.",
  },
  {
    status: "Built",
    title: "Secure document handling",
    body: "Virus scanning, encrypted storage, private files with short-lived signed links, and duplicate-print protection.",
  },
  {
    status: "Built",
    title: "Business operations layer",
    body: "Roles, printer allocation, paper inventory, business settings, and automation rules with per-shop toggles and an audit trail.",
  },
  {
    status: "In progress",
    title: "Back-office web application",
    body: "A full web console for owners and managers: catalogue and pricing, suppliers, dashboards, search and reports.",
  },
  {
    status: "In progress",
    title: "Native Windows printer agent",
    body: "A faster, lighter agent rewritten natively, being proven against the current agent before it replaces it.",
  },
  {
    status: "Planned",
    title: "Platform administration and wider integrations",
    body: "Tools for running the platform at scale and connecting to more payment, accounting and messaging services.",
  },
];

export type TeamMember = { name: string; role: string; bio: string };

/** Placeholder team - replace with real people before launch. */
export const team: TeamMember[] = [
  { name: "[Name]", role: "Founder and CEO", bio: "[Short bio placeholder.]" },
  { name: "[Name]", role: "Engineering lead", bio: "[Short bio placeholder.]" },
  { name: "[Name]", role: "Product and design", bio: "[Short bio placeholder.]" },
];

export const culture = [
  {
    title: "Small team, real ownership",
    body: "You will ship things that shop owners use the same week.",
  },
  {
    title: "Talk to customers",
    body: "Everyone spends time with print shops. The best ideas start on the shop floor.",
  },
  {
    title: "Write it down",
    body: "Decisions and plans live in writing so people can work when and where they do their best work.",
  },
  {
    title: "Care about quality",
    body: "We review each other's work, test what we build and fix what we break.",
  },
];

export type OpenRole = { title: string; team: string; location: string; summary: string };

/** Placeholder roles - not real vacancies. */
export const openRoles: OpenRole[] = [
  {
    title: "[Placeholder] Full-stack engineer",
    team: "Engineering",
    location: "[Remote / location TBC]",
    summary: "Build ordering, queue and back-office features across web and API.",
  },
  {
    title: "[Placeholder] Windows / C++ engineer",
    team: "Engineering",
    location: "[Remote / location TBC]",
    summary: "Work on the native printer agent and Windows printing internals.",
  },
  {
    title: "[Placeholder] Customer success specialist",
    team: "Customer",
    location: "[Remote / location TBC]",
    summary: "Onboard print shops and turn what you learn into product improvements.",
  },
  {
    title: "[Placeholder] Product designer",
    team: "Design",
    location: "[Remote / location TBC]",
    summary: "Design fast, clear tools for counter staff and operators.",
  },
];

export const pressBoilerplate =
  "Print Automated is the operating system for print shops. Customers order online, jobs are routed to the right printer automatically, and shop staff stay in control of pricing, inventory and production. [Boilerplate placeholder: confirm wording, founding date and location before publishing.]";

export const pressFacts = [
  { label: "Company", value: "Print Automated" },
  { label: "What we make", value: "Software for print shops" },
  {
    label: "Products",
    value: "Customer ordering web, shop mobile app, back-office web, Windows printer agent",
  },
  { label: "Founded", value: "[To be confirmed]" },
  { label: "Headquarters", value: "[To be confirmed]" },
  { label: "Team size", value: "[To be confirmed]" },
];

export const brandGuidance = [
  {
    title: "Name",
    body: "Write the name as “Print Automated”: two words, both capitalised. Do not abbreviate it, join it into one word, or add a suffix.",
  },
  {
    title: "Logo",
    body: "The logo is a mark built from four dots in the print process colours - cyan, magenta, yellow and black (CMYK) - beside the wordmark. Keep clear space around it equal to one dot, do not recolour, rotate or stretch it, and place it on backgrounds with enough contrast.",
  },
  {
    title: "Colour and type",
    body: "The product uses a blue primary colour on white and deep navy, with Inter for text and JetBrains Mono for small labels. CMYK colours are reserved for tiny accents.",
  },
  {
    title: "Files",
    body: "Logo files are not available for download on this site yet. Email us and we will send the current assets.",
  },
];
