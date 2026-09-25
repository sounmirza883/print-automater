import { Badge, Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { auditEntries, securityItems } from "@/content/security";

export function Security() {
  return (
    <Section id="security" tone="dark">
      <SectionHeader
        id="security"
        tone="dark"
        eyebrow="Security"
        title="Built to keep your shop and your customers' files safe"
        lede="Security is part of the design, not an add-on. Files, people and printers are protected at every step."
      />

      <div className="mt-14 grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <Reveal>
          <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {securityItems.map((item) => (
              <li key={item.title} className="flex gap-3">
                <IconTile icon={item.icon} size="sm" tone="dark" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-300">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={100}>
          <Card tone="dark" padded={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
              <h3 className="font-mono text-xs tracking-wide text-ink-200 uppercase">Audit log</h3>
              <Badge variant="dark" dot="green">
                Sample data
              </Badge>
            </div>
            <ol className="divide-y divide-white/10">
              {auditEntries.map((entry) => (
                <li key={`${entry.time}-${entry.action}`} className="flex gap-4 px-5 py-3.5">
                  <span className="font-mono text-xs text-ink-300 pt-0.5">{entry.time}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-white">
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
