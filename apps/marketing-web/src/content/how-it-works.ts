import { Link2, Package, Settings2, Usb, type LucideIcon } from "lucide-react";

export type HowItWorksStep = {
  id: string;
  title: string;
  description: string;
  detail: string;
  icon: LucideIcon;
};

export const howItWorksSteps: readonly HowItWorksStep[] = [
  {
    id: "create-shop",
    title: "Create your shop and set prices",
    description:
      "We set up your shop account, then you add your price list for paper, sizes, colour and finishing.",
    detail: "Takes about ten minutes",
    icon: Settings2,
  },
  {
    id: "pair-printer",
    title: "Install the printer agent",
    description:
      "Run the small agent on the Windows PC beside your printers, then pair it with a short device code.",
    detail: "No ports opened to the internet",
    icon: Usb,
  },
  {
    id: "share-link",
    title: "Share your ordering link",
    description:
      "Put your shop link on your website, a QR poster or a WhatsApp status. Customers order without any setup.",
    detail: "One link per shop",
    icon: Link2,
  },
  {
    id: "print-pickup",
    title: "Jobs print and customers pick up",
    description:
      "Paid orders route to a suitable printer, operators watch the queue, and customers are told when their order is ready.",
    detail: "Status updates sent automatically",
    icon: Package,
  },
];
