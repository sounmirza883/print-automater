import { ArrowDown, BookOpen, Check, Shuffle } from "lucide-react";
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
      tone="light"
      className="overflow-hidden pb-16 pt-16 sm:pt-20 md:pb-24 md:pt-24"
    >
      <Reveal>
        <SectionHeader
          as="h1"
          align="center"
          id="hero"
          eyebrow="The operating system for print shops"
          title="From upload to pickup, printing that runs itself."
          lede="Customers order online with live pricing. Each job is routed to the right printer, and rerouted if one goes down. Your staff see the whole queue and stay in control."
        />
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button href={siteConfig.docsUrl} size="lg">
            <BookOpen className="size-4" aria-hidden="true" />
            View documentation
          </Button>
          <Button href="#product-preview" size="lg" variant="secondary">
            <ArrowDown className="size-4" aria-hidden="true" />
            See the dashboard
          </Button>
        </div>
        <ul className="mt-10 flex flex-col items-center justify-center gap-x-8 gap-y-2 text-base text-ink-600 sm:flex-row sm:flex-wrap">
          {proof.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <Check className="size-4 text-ink-950" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={150} className="relative mx-auto mt-14 max-w-6xl md:mt-20">
        <p className="sr-only">
          Illustration of the shop dashboard: live order and printer status, with a notice that a
          job was rerouted from Printer 2, which is offline, to Printer 4.
        </p>
        <div aria-hidden="true" className="relative">
          <BrowserFrame>
            <div className="relative max-h-[30rem] overflow-hidden sm:max-h-[36rem] lg:max-h-[42rem]">
              <DashboardMock />
            </div>
          </BrowserFrame>
          <div className="absolute -top-6 right-2 z-10 sm:-top-9 sm:right-6 lg:right-10">
            <div className="flex max-w-[16.5rem] items-start gap-3 border border-ink-900 bg-white p-3 sm:max-w-xs sm:p-4">
              <span className="flex size-8 shrink-0 items-center justify-center bg-ink-900 text-ink-50">
                <Shuffle className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-950">Job rerouted</p>
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
    </Section>
  );
}
