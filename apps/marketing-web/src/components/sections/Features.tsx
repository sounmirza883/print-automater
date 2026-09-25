import { ArrowRight, Check } from "lucide-react";
import { IconTile, Reveal, Section, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { features } from "@/content/features";
import { FeaturePreview } from "./features/FeaturePreview";

export function Features() {
  return (
    <Section id="features" tone="muted">
      <SectionHeader
        id="features"
        eyebrow="Core features"
        title="Everything between the upload and the pickup"
        lede="Six connected parts of one system, so an order never has to be retyped, re-quoted or chased."
      />

      <ol className="mt-16 space-y-20 md:space-y-28">
        {features.map((f, i) => {
          const flip = i % 2 === 1;
          return (
            <li key={f.id}>
              <Reveal className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
                <div className={cn(flip && "lg:order-2")}>
                  <IconTile icon={f.icon} size="lg" tone="brand" />
                  <h3 className="mt-5 text-2xl font-semibold tracking-tight text-ink-900">
                    {f.name}
                  </h3>
                  <p className="mt-3 text-base leading-relaxed text-ink-600">{f.description}</p>
                  <ul className="mt-5 space-y-2.5">
                    {f.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5 text-sm text-ink-700">
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-brand-600"
                          strokeWidth={2.25}
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={f.href}
                    className="group mt-6 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-700 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500"
                  >
                    Learn more<span className="sr-only"> about {f.name}</span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-1"
                    />
                  </a>
                </div>
                <div className={cn("mx-auto w-full max-w-md lg:max-w-none", flip && "lg:order-1")}>
                  <FeaturePreview kind={f.preview} />
                </div>
              </Reveal>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
