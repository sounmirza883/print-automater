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

      <ul className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {resources.map((r, i) => (
          <li key={r.title}>
            <Reveal delay={(i % 3) * 60} className="h-full">
              <Card interactive className="group relative h-full">
                <IconTile icon={r.icon} tone="brand" />
                <h3 className="mt-5 text-lg font-bold text-ink-950">{r.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-ink-600">{r.description}</p>
                <a
                  href={r.href}
                  className="mt-5 inline-flex items-center gap-2 text-base font-medium text-ink-950 after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4"
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
