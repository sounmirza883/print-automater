import { siteConfig } from "./site";

export type NavLink = { label: string; href: string };

/** Anchor links to page sections; ids match the components/sections/* roots. */
export const primaryNav: readonly NavLink[] = [
  { label: "Features", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Resources", href: "/#resources" },
  { label: "FAQ", href: "/#faq" },
];

export const headerCtas = {
  login: { label: "Log in", href: siteConfig.loginUrl },
  primary: { label: "Get started", href: siteConfig.signUpUrl },
} as const;
