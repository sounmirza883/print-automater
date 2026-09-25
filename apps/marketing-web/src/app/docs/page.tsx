import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Code2,
  Printer,
  Rocket,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DocPage } from "@/components/docs";
import { Card, IconTile } from "@/components/ui";
import { docsGroups } from "@/content/docs";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Guides and reference for Print Automated: set up your business, pair the Windows printer agent, understand orders and pricing, and use the REST API.",
  alternates: { canonical: "/docs" },
};

const icons: Record<string, LucideIcon> = {
  "/docs/getting-started": Rocket,
  "/docs/printer-agent": Printer,
  "/docs/order-lifecycle": Workflow,
  "/docs/roles-and-permissions": Users,
  "/docs/pricing-rules": BookOpen,
  "/docs/api-reference": Code2,
  "/docs/webhooks": Webhook,
};

const quickStart = [
  { label: "Set up your business and take a first order", href: "/docs/getting-started" },
  { label: "Install and pair the printer agent", href: "/docs/printer-agent" },
  { label: "Authenticate and call the API", href: "/docs/api-reference#authentication" },
  { label: "See which statuses an order passes through", href: "/docs/order-lifecycle" },
];

const slug = (s: string) => s.toLowerCase().replaceAll(" ", "-");

export default function DocsHomePage() {
  return (
    <DocPage
      href="/docs"
      title="Print Automated documentation"
      lede="How to run a print shop on Print Automated: set up, connect your printers, understand how orders and prices work, and integrate with the API."
    >
      <h2 id="quick-start">Quick start</h2>
      <ul className="list-none! space-y-2! pl-0!">
        {quickStart.map((q) => (
          <li key={q.href}>
            <Link href={q.href} className="inline-flex items-center gap-2">
              {q.label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      {docsGroups.map((g) => (
        <section key={g.title} aria-labelledby={`group-${slug(g.title)}`}>
          <h2 id={`group-${slug(g.title)}`}>{g.title}</h2>
          <ul className="mt-4! grid list-none! gap-4 space-y-0! pl-0! sm:grid-cols-2">
            {g.pages.map((p) => {
              const Icon = icons[p.href] ?? BookOpen;
              return (
                <li key={p.href}>
                  <Card interactive className="relative h-full">
                    <IconTile icon={Icon} tone="brand" size="sm" />
                    <h3 className="mt-4!">
                      <Link href={p.href} className="no-underline! after:absolute after:inset-0">
                        {p.title}
                      </Link>
                    </h3>
                    <p className="mt-2! text-sm">{p.description}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <h2 id="about-these-docs">About these docs</h2>
      <p>
        Everything here describes what the product does today. Where a capability is designed but
        not shipped yet, the page says <strong>planned</strong> and does not describe it as
        available. Business-facing screens say &ldquo;Business&rdquo;; in the API and code the same
        thing is called a <code>shop</code>.
      </p>
    </DocPage>
  );
}
