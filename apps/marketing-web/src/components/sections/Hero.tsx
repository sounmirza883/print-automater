import { BookOpen, Check, Shuffle } from "lucide-react";
import { BrowserFrame, DashboardMock } from "@/components/preview";
import { Button, Reveal, Section, SectionHeader } from "@/components/ui";
import { siteConfig } from "@/content/site";

const proof = [
  "Live pricing at checkout",
  "Automatic printer failover",
  "Every automation has an off switch",
];

export function Hero() {
  return (
    <Section
      id="hero"
      tone="dark"
      className="overflow-hidden pb-16 pt-16 sm:pt-20 md:pb-24 md:pt-24"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(37,99,235,0.35),transparent_70%)]"
      />
      <div className="relative">
        <Reveal>
          <SectionHeader
            as="h1"
            id="hero"
            tone="dark"
            eyebrow="The operating system for print shops"
            title="From upload to pickup, printing that runs itself."
            lede="Customers order online with live pricing. Each job is routed to the right printer, and rerouted if one goes down. Your staff see the whole queue and stay in control."
          />
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <Button href={siteConfig.docsUrl} size="lg" variant="secondary" tone="dark">
              <BookOpen className="size-4" aria-hidden="true" />
              View documentation
            </Button>
          </div>
          <ul className="mt-8 flex flex-col items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-200 sm:flex-row sm:flex-wrap">
            {proof.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <Check className="size-4 text-cmyk-cyan" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={150} className="relative mx-auto mt-12 max-w-6xl md:mt-16">
          <p className="sr-only">
            Illustration of the shop dashboard: live order and printer status, with a notice that a
            job was rerouted from Printer 2, which is offline, to Printer 4.
          </p>
          <div aria-hidden="true" className="relative">
            <BrowserFrame>
              <div className="relative max-h-[30rem] overflow-hidden sm:max-h-[36rem] lg:max-h-[42rem]">
                <DashboardMock />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-50 to-transparent" />
              </div>
            </BrowserFrame>
            <div className="absolute -top-4 right-2 z-10 sm:-top-5 sm:right-6 lg:right-10">
              <div className="animate-float flex max-w-[16.5rem] items-start gap-3 rounded-xl border border-ink-100 bg-white p-3 shadow-xl shadow-black/30 sm:max-w-xs sm:p-3.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <Shuffle className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">Job rerouted</p>
                  <p className="text-xs text-ink-700">
                    Printer 2 offline <span aria-hidden="true">&rarr;</span> Printer 4
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">
                    PA-10481, 120 pp, just now
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
