import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { FinalCta } from "@/components/sections/FinalCta";
import { Badge, Card, Section } from "@/components/ui";
import { customerStories, storiesNote } from "@/content/customer-stories";
import { testimonials } from "@/content/testimonials";

export const metadata: Metadata = {
  title: "Customer stories",
  description:
    "Illustrative examples of how different kinds of print shops could use Print Automated. Fictional shops and placeholder figures.",
};

export default function CustomerStoriesPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Customer stories"
        title="How different print shops could use Print Automated"
        lede={storiesNote}
        crumbs={[{ label: "Home", href: "/" }, { label: "Customer stories" }]}
      />

      <Section id="stories" tone="muted" labelledBy="" aria-label="Illustrative customer stories">
        <ul className="space-y-8">
          {customerStories.map((s) => {
            const quote = testimonials.find((t) => t.shop === s.testimonialShop);
            return (
              <li key={s.id}>
                <Card padded={false}>
                  <article aria-labelledby={`${s.id}-title`} className="p-6 md:p-8">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="warning">Illustrative example</Badge>
                      <Badge variant="outline">{s.type}</Badge>
                    </div>
                    <h2
                      id={`${s.id}-title`}
                      className="mt-4 text-2xl font-semibold tracking-tight text-ink-900"
                    >
                      {s.headline}
                    </h2>
                    <p className="mt-1 text-sm text-ink-600">
                      {s.shop} · {s.location}
                    </p>

                    <dl className="mt-6 grid gap-3 sm:grid-cols-3">
                      {s.highlights.map((h) => (
                        <div key={h.label} className="bg-brand-50 p-4">
                          <dt className="text-xs font-medium text-ink-700">{h.label}</dt>
                          <dd className="mt-1 text-lg font-semibold text-brand-800">{h.value}</dd>
                        </div>
                      ))}
                    </dl>

                    <div className="mt-6 grid gap-6 md:grid-cols-3">
                      {[
                        ["Challenge", s.challenge],
                        ["Approach", s.solution],
                        ["Outcome", s.result],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-ink-600">
                            {k}
                          </h3>
                          <p className="mt-2 text-sm leading-relaxed text-ink-700">{v}</p>
                        </div>
                      ))}
                    </div>

                    {quote ? (
                      <figure className="mt-6 border-l-2 border-brand-300 pl-4">
                        <blockquote className="text-ink-800">{quote.quote}</blockquote>
                        <figcaption className="mt-2 text-sm text-ink-600">
                          {quote.name}, {quote.role}, {quote.shop} (placeholder)
                        </figcaption>
                      </figure>
                    ) : null}
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>

        <p className="mt-10 text-sm text-ink-600">
          {storiesNote}{" "}
          <a
            href="/#testimonials"
            className="inline-flex items-center gap-1 font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
          >
            See more testimonials
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </a>
        </p>
      </Section>
      <FinalCta />
    </PageShell>
  );
}
