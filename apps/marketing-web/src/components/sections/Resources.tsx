import { ArrowRight } from "lucide-react";
import { Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { resources } from "@/content/resources";

export function Resources() {
  return (
    <Section id="resources" tone="light">
      <SectionHeader
        id="resources"
        eyebrow="Resources"
        title="Everything you need to get going"
        lede="Clear documentation, practical guides and real people when you need them."
      />

      <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {resources.map((r, i) => (
          <li key={r.title}>
            <Reveal delay={(i % 3) * 60} className="h-full">
              <Card interactive className="group relative h-full">
                <IconTile icon={r.icon} tone="brand" />
                <h3 className="mt-4 text-base font-semibold text-ink-900">{r.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{r.description}</p>
                <a
                  href={r.href}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 after:absolute after:inset-0 after:rounded-2xl hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  {r.cta}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </a>
              </Card>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
