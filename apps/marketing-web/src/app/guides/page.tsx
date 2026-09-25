import type { Metadata } from "next";
import { ArrowRight, Clock } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { Badge, Card, IconTile, Section } from "@/components/ui";
import { guides } from "@/content/guides";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Practical guides for print shops: pricing rules, connecting a printer, offline printers, paper stock, roles and permissions, refunds and reprints.",
};

export default function GuidesPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Guides"
        title="Practical guides for running your shop"
        lede="Short, task-focused articles for the things you will actually do. For a full walkthrough, try the tutorials."
        crumbs={[{ label: "Home", href: "/" }, { label: "Guides" }]}
      />
      <Section id="guide-list" tone="muted" labelledBy="" aria-label="All guides">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {guides.map((g) => (
            <li key={g.slug}>
              <a
                href={`/guides/${g.slug}`}
                className="group block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500"
              >
                <Card interactive className="h-full">
                  <div className="flex items-center justify-between gap-3">
                    <IconTile icon={g.icon} tone="light" />
                    <Badge variant="neutral">{g.category}</Badge>
                  </div>
                  <h2 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">
                    {g.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{g.summary}</p>
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1.5 text-ink-600">
                      <Clock aria-hidden="true" className="size-4" />
                      {g.minutes} min
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700 group-hover:text-brand-800">
                      Read
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 transition-transform group-hover:translate-x-1"
                      />
                    </span>
                  </div>
                </Card>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-ink-600">
          Looking for a linear walkthrough?{" "}
          <a
            href="/tutorials"
            className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
          >
            Follow a step-by-step tutorial
          </a>
          .
        </p>
      </Section>
    </PageShell>
  );
}
