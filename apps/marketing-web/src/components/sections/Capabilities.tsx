import { Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { capabilities } from "@/content/capabilities";

export function Capabilities() {
  return (
    <Section id="capabilities" tone="light">
      <SectionHeader
        id="capabilities"
        eyebrow="Capabilities"
        title="The foundations a real print business needs"
        lede="Behind the friendly screens is a platform built for accuracy, privacy and control."
      />
      <ul className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {capabilities.map((c, i) => (
          <li key={c.id}>
            <Reveal delay={(i % 3) * 70} className="h-full">
              <Card interactive className="h-full">
                <IconTile icon={c.icon} />
                <h3 className="mt-5 text-lg font-bold text-ink-950">{c.name}</h3>
                <p className="mt-2 text-base leading-relaxed text-ink-600">{c.detail}</p>
              </Card>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
