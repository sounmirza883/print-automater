import { Badge, Card, Reveal, Section, SectionHeader } from "@/components/ui";
import { integrations } from "@/content/integrations";

export function Integrations() {
  return (
    <Section id="integrations" tone="muted">
      <SectionHeader
        id="integrations"
        eyebrow="Integrations"
        title="Works with the printers and tools you already have"
        lede="Any printer brand with a Windows driver, standard storage and email, and an API for everything else."
      />

      <ul className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {integrations.map((item, i) => (
          <li key={item.name}>
            <Reveal delay={(i % 4) * 60} className="h-full">
              <Card interactive className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-12 min-w-12 items-center justify-center bg-ink-900 px-2 font-mono text-xs font-medium tracking-wide text-ink-50"
                  >
                    {item.monogram}
                  </span>
                  {item.status === "coming-soon" ? (
                    <Badge variant="warning">Coming soon</Badge>
                  ) : null}
                </div>
                <h3 className="mt-5 text-lg font-bold text-ink-950">{item.name}</h3>
                <p className="mt-2 text-base leading-relaxed text-ink-600">{item.description}</p>
              </Card>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
