import { Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { useCases } from "@/content/use-cases";

export function UseCases() {
  return (
    <Section id="use-cases" tone="muted">
      <SectionHeader
        id="use-cases"
        eyebrow="Use cases"
        title="One system, whatever kind of print room you run"
        lede="From a single-counter copy shop to a chain of branches, the same workflow scales to fit."
      />
      <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {useCases.map((u, i) => (
          <li key={u.id}>
            <Reveal delay={(i % 3) * 70} className="h-full">
              <Card interactive className="flex h-full flex-col">
                <IconTile icon={u.icon} tone="brand" />
                <h3 className="mt-4 text-lg font-semibold text-ink-900">{u.name}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{u.description}</p>
                <p className="mt-4 border-t border-ink-100 pt-3 font-mono text-xs uppercase tracking-wider text-brand-700">
                  {u.outcome}
                </p>
              </Card>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
