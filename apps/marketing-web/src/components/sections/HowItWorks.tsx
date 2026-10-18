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
      <ol className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {howItWorksSteps.map((s, i) => (
          <li key={s.id} className="relative">
            <Reveal delay={i * 80} className="h-full">
              <div className="group h-full border border-ink-400 bg-ink-50 p-6 transition-colors duration-150 hover:border-ink-900 hover:bg-white">
                <div className="flex items-center justify-between">
                  <IconTile icon={s.icon} tone="brand" />
                  <span aria-hidden="true" className="font-mono text-3xl font-medium text-ink-400">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-bold text-ink-950">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-base leading-relaxed text-ink-600">{s.description}</p>
                <Badge variant="outline" dot className="mt-5">
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
