import { Badge, Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { auditEntries, securityItems } from "@/content/security";

export function Security() {
  return (
    <Section id="security" tone="light">
      <SectionHeader
        id="security"
        eyebrow="Security"
        title="Built to keep your shop and your customers' files safe"
        lede="Security is part of the design, not an add-on. Files, people and printers are protected at every step."
      />

      <div className="mt-16 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <Reveal>
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {securityItems.map((item) => (
              <li key={item.title} className="flex gap-4">
                <IconTile icon={item.icon} size="sm" />
                <div>
                  <h3 className="text-base font-bold text-ink-950">{item.title}</h3>
                  <p className="mt-1 text-base leading-relaxed text-ink-600">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={100}>
          <Card tone="dark" padded={false} data-tone="dark">
            <div className="flex items-center justify-between border-b border-ink-600 px-5 py-4">
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink-300">Audit log</h3>
              <Badge variant="dark" dot>
                Sample data
              </Badge>
            </div>
            <ol className="divide-y divide-ink-700">
              {auditEntries.map((entry) => (
                <li key={`${entry.time}-${entry.action}`} className="flex gap-4 px-5 py-4">
                  <span className="pt-0.5 font-mono text-xs text-ink-300">{entry.time}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-50">
                      <span className="font-medium">{entry.action}</span>
                      <span className="text-ink-300"> by {entry.actor}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-300">{entry.target}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}
