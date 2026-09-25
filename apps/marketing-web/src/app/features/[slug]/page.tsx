import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { FinalCta } from "@/components/sections/FinalCta";
import { FeaturePreview } from "@/components/sections/features/FeaturePreview";
import { Button, Card, IconTile, Section, SectionHeader } from "@/components/ui";
import { featurePages, getFeaturePage } from "@/content/feature-pages";
import { siteConfig } from "@/content/site";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return featurePages.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const feature = getFeaturePage(slug);
  if (!feature) return {};
  return { title: feature.name, description: feature.summary };
}

export default async function FeaturePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const feature = getFeaturePage(slug);
  if (!feature) notFound();

  const related = feature.related
    .map((s) => getFeaturePage(s))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  return (
    <PageShell>
      <PageHero
        eyebrow={feature.name}
        title={feature.headline}
        lede={feature.lede}
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Features", href: "/features" },
          { label: feature.name },
        ]}
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button href={siteConfig.signUpUrl} size="lg" tone="dark">
            Start free trial
          </Button>
          <Button href="/features" size="lg" variant="secondary" tone="dark">
            All features
          </Button>
        </div>
      </PageHero>

      <Section id="benefits" tone="light">
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader id="benefits" align="left" eyebrow="Why it helps" title="What you get" />
            <ul className="mt-10 space-y-6">
              {feature.benefits.map((b) => (
                <li key={b.title} className="flex gap-4">
                  <IconTile icon={b.icon} tone="light" />
                  <div>
                    <h3 className="font-semibold text-ink-900">{b.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{b.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <FeaturePreview kind={feature.preview} />
          </div>
        </div>
      </Section>

      <Section id="how-it-works" tone="muted">
        <SectionHeader id="how-it-works" align="left" eyebrow="How it works" title="Step by step" />
        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {feature.steps.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <span className="font-mono text-sm font-semibold text-brand-700">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="feature-faq" tone="light">
        <SectionHeader id="feature-faq" align="left" eyebrow="Questions" title="Good to know" />
        <dl className="mt-10 max-w-3xl divide-y divide-ink-100 border-y border-ink-100">
          {feature.faqs.map((f) => (
            <div key={f.question} className="py-5">
              <dt className="font-semibold text-ink-900">{f.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-600">{f.answer}</dd>
            </div>
          ))}
        </dl>

        {related.length > 0 ? (
          <nav aria-label="Related features" className="mt-14">
            <h2 className="text-lg font-semibold text-ink-900">Related features</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.slug}>
                  <a
                    href={`/features/${r.slug}`}
                    className="group flex h-full items-center gap-4 rounded-2xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    <IconTile icon={r.icon} tone="light" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink-900">{r.name}</span>
                      <span className="block text-sm text-ink-600">{r.summary}</span>
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-brand-700 transition-transform group-hover:translate-x-1"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </Section>
      <FinalCta />
    </PageShell>
  );
}
