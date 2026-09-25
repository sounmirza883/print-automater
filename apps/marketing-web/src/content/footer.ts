import { siteConfig } from "./site";
import type { NavLink } from "./navigation";

export type FooterColumn = { title: string; links: readonly NavLink[] };

export const footerColumns: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#overview" },
      { label: "Product preview", href: "/#product-preview" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Integrations", href: "/#integrations" },
    ],
  },
  {
    title: "Features",
    links: [
      { label: "Online ordering", href: "/features/online-ordering" },
      { label: "Printer allocation", href: "/features/printer-allocation" },
      { label: "Production queue", href: "/features/production-queue" },
      { label: "Paper inventory", href: "/features/paper-inventory" },
      { label: "Payments and invoices", href: "/features/payments-invoices" },
      { label: "Reports", href: "/features/reports" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Guides", href: "/guides" },
      { label: "Tutorials", href: "/tutorials" },
      { label: "Customer stories", href: "/customer-stories" },
      { label: "Support", href: "/support" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Documentation",
    links: [
      { label: "Getting started", href: "/docs/getting-started" },
      { label: "Printer agent setup", href: "/docs/printer-agent" },
      { label: "API reference", href: "/docs/api-reference" },
      { label: "Webhooks", href: "/docs/webhooks" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Blog", href: "/blog" },
      { label: "Press", href: "/press" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Security", href: "/security" },
      { label: "Data processing", href: "/data-processing" },
    ],
  },
];

export const footerContact = {
  title: "Contact",
  email: siteConfig.contactEmail,
  lines: ["Questions about your shop setup?", "We reply within one business day."],
} as const;

export type SocialId = "twitter" | "linkedin" | "github" | "youtube";
export const footerSocials: readonly { id: SocialId; label: string; href: string }[] = [
  { id: "twitter", label: "Print Automated on X", href: siteConfig.social.twitter },
  { id: "linkedin", label: "Print Automated on LinkedIn", href: siteConfig.social.linkedin },
  { id: "github", label: "Print Automated on GitHub", href: siteConfig.social.github },
  { id: "youtube", label: "Print Automated on YouTube", href: siteConfig.social.youtube },
];
