import { BookOpen, Code2, Compass, LifeBuoy, PlayCircle, type LucideIcon } from "lucide-react";
import { siteConfig } from "./site";

export type Resource = {
  title: string;
  description: string;
  cta: string;
  href: string;
  icon: LucideIcon;
};

export const resources: Resource[] = [
  {
    title: "Documentation",
    description: "Set up your shop, invite staff and learn how every screen works.",
    cta: "Read the docs",
    href: siteConfig.docsUrl,
    icon: BookOpen,
  },
  {
    title: "API Reference",
    description: "Endpoints, webhooks and authentication for connecting your own tools.",
    cta: "Browse the API",
    href: "/docs/api-reference",
    icon: Code2,
  },
  {
    title: "Guides",
    description: "Practical walkthroughs for pricing rules, printer setup and inventory.",
    cta: "Open guides",
    href: "/guides",
    icon: Compass,
  },
  {
    title: "Tutorials",
    description:
      "Step-by-step written walkthroughs that take you from first order to a full day at the counter.",
    cta: "Follow a tutorial",
    href: "/tutorials",
    icon: PlayCircle,
  },
  {
    title: "Support",
    description: "Talk to a person when something needs a hand. We reply within a business day.",
    cta: "Contact support",
    href: "/support",
    icon: LifeBuoy,
  },
];
