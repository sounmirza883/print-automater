import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { FinalCta } from "@/components/sections/FinalCta";
import { Card, IconTile, Section } from "@/components/ui";
import { featurePages } from "@/content/feature-pages";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Online ordering, printer allocation, a live production queue, paper inventory, payments and reports in one system for print shops.",
};

export default function FeaturesPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Features"
        title="Everything between the upload and the pickup"
        lede="Six connected parts of one system, so an order never has to be retyped, re-quoted or chased."
        crumbs={[{ label: "Home", href: "/" }, { label: "Features" }]}
      />
      <Section id="all-features" tone="muted" labelledBy="" aria-label="All features">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featurePages.map((f) => (
            <li key={f.slug}>
              <a
                href={`/features/${f.slug}`}
                className="group block h-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500"
              >
                <Card interactive className="h-full">
                  <IconTile icon={f.icon} size="lg" tone="brand" />
                  <h2 className="mt-5 text-xl font-bold text-ink-950">{f.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.summary}</p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 group-hover:text-brand-800">
                    Learn more
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-1"
                    />
                  </span>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      </Section>
      <FinalCta />
    </PageShell>
  );
}
