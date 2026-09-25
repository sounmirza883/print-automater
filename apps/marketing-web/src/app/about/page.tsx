import type { Metadata } from "next";
import { PageHero, PageShell, Prose } from "@/components/pages";
import { Badge, Button, Card, Container } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import {
  mission,
  principles,
  story,
  team,
  timeline,
  values,
  type TimelineStatus,
} from "@/content/company";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Print Automated is building the operating system for print shops. Our mission, story, principles and what is built versus planned.",
  alternates: { canonical: "/about" },
};

const statusVariant: Record<TimelineStatus, BadgeVariant> = {
  Built: "success",
  "In progress": "brand",
  Planned: "outline",
};

export default function AboutPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Company"
        title="Software that lets print shops run like a big operation"
        lede={mission}
        crumbs={[{ label: "Home", href: "/" }, { label: "About" }]}
      />

      <Container className="space-y-16 py-14 md:space-y-24 md:py-20">
        <section aria-labelledby="story" className="max-w-3xl">
          <h2 id="story" className="text-2xl font-semibold tracking-tight text-ink-900">
            Our story
          </h2>
          <Prose>
            {story.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </Prose>
        </section>

        <section aria-labelledby="principles">
          <h2 id="principles" className="text-2xl font-semibold tracking-tight text-ink-900">
            How we build
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {principles.map((p) => (
              <li key={p.title}>
                <Card className="h-full">
                  <h3 className="font-semibold text-ink-900">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">{p.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="values">
          <h2 id="values" className="text-2xl font-semibold tracking-tight text-ink-900">
            Our values
          </h2>
          <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => (
              <div key={v.title} className="border-t-2 border-brand-600 pt-3">
                <dt className="font-semibold text-ink-900">{v.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink-700">{v.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="timeline">
          <h2 id="timeline" className="text-2xl font-semibold tracking-tight text-ink-900">
            What is built and what is planned
          </h2>
          <p className="mt-3 max-w-2xl text-ink-700">
            We label each item honestly, so you know what you can use today.
          </p>
          <ol className="mt-8 space-y-4 border-l border-ink-200 pl-6">
            {timeline.map((item) => (
              <li key={item.title} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.85rem] top-1.5 size-3 rounded-full border-2 border-white bg-brand-600 ring-1 ring-ink-200"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink-900">{item.title}</h3>
                  <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-700">{item.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="team">
          <h2 id="team" className="text-2xl font-semibold tracking-tight text-ink-900">
            The team
          </h2>
          <p className="mt-3 inline-block rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Placeholder: team details to be added before launch.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {team.map((m) => (
              <li key={m.role}>
                <Card className="h-full">
                  <div aria-hidden="true" className="size-14 rounded-full bg-ink-100" />
                  <h3 className="mt-4 font-semibold text-ink-900">{m.name}</h3>
                  <p className="text-sm text-ink-600">{m.role}</p>
                  <p className="mt-2 text-sm text-ink-700">{m.bio}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="about-cta"
          className="rounded-2xl bg-ink-950 p-8 text-white md:p-12"
        >
          <h2 id="about-cta" className="text-2xl font-semibold tracking-tight">
            Want to see it in your shop?
          </h2>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button href={siteConfig.signUpUrl} tone="dark">
              Start free trial
            </Button>
            <Button href="/careers" variant="secondary" tone="dark">
              Join the team
            </Button>
          </div>
        </section>
      </Container>
    </PageShell>
  );
}
