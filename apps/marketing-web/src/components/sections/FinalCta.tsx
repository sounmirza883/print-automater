import { Button, Reveal, Section } from "@/components/ui";
import { siteConfig } from "@/content/site";

export function FinalCta() {
  return (
    <Section id="final-cta" tone="dark" className="overflow-hidden">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2
          id="final-cta-title"
          className="text-balance text-4xl font-bold leading-[1.2] text-ink-50 md:text-5xl lg:text-6xl"
        >
          Put your print shop on autopilot
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-300">
          Take orders online, let jobs find the right printer, and keep your team in control. Set up
          in an afternoon.
        </p>
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button href={`mailto:${siteConfig.contactEmail}`} size="lg" tone="dark">
            Book a demo
          </Button>
        </div>
      </Reveal>
    </Section>
  );
}
