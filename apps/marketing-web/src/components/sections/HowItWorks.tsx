import { Badge, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { howItWorksSteps } from "@/content/how-it-works";

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="light">
      <SectionHeader
        id="how-it-works"
        eyebrow="How it works"
        title="From onboarding to first printed order in four steps"
        lede="No new hardware and no IT team. If your printers work from a Windows PC today, they work with Print Automated."
      />
      <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {howItWorksSteps.map((s, i) => (
          <li key={s.id} className="relative">
            <Reveal delay={i * 80} className="h-full">
              <div className="group h-full rounded-2xl border border-ink-100 bg-ink-50 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white hover:shadow-md">
                <div className="flex items-center justify-between">
                  <IconTile icon={s.icon} tone="brand" />
                  <span
                    aria-hidden="true"
                    className="font-mono text-3xl font-semibold text-ink-200"
                  >
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-ink-900">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.description}</p>
                <Badge variant="brand" dot="brand" className="mt-4">
                  {s.detail}
                </Badge>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  );
}
