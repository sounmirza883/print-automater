import { ArrowRight } from "lucide-react";
import { Button, Reveal, Section } from "@/components/ui";
import { siteConfig } from "@/content/site";

export function FinalCta() {
  return (
    <Section id="final-cta" tone="dark" className="overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-brand-500 to-transparent"
      />
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2
          id="final-cta-title"
          className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl md:text-5xl"
        >
          Put your print shop on autopilot
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink-200">
          Take orders online, let jobs find the right printer, and keep your team in control. Set up
          in an afternoon.
        </p>
        <div className="mt-9 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button href={siteConfig.signUpUrl} size="lg" tone="dark">
            Start free trial
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
          <Button
            href={`mailto:${siteConfig.contactEmail}`}
            size="lg"
            variant="secondary"
            tone="dark"
          >
            Book a demo
          </Button>
        </div>
      </Reveal>
    </Section>
  );
}
