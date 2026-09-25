import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { PageHero, PageShell, Prose } from "@/components/pages";
import { Badge, Container } from "@/components/ui";
import { getGuide, guides, type GuideBlock } from "@/content/guides";

type Params = { slug: string };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return guides.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return { title: guide.title, description: guide.summary };
}

function Block({ block }: { block: GuideBlock }) {
  if (block.type === "p") return <p>{block.text}</p>;
  const Tag = block.type === "steps" ? "ol" : "ul";
  return (
    <Tag>
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </Tag>
  );
}

export default async function GuidePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const related = guide.related
    .map((s) => getGuide(s))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));

  return (
    <PageShell>
      <PageHero
        eyebrow={`Guide · ${guide.category}`}
        title={guide.title}
        lede={guide.intro}
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Guides", href: "/guides" },
          { label: guide.title },
        ]}
      >
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-200">
          <Clock aria-hidden="true" className="size-4" />
          About {guide.minutes} minutes
        </p>
      </PageHero>

      <div className="bg-white py-14 md:py-20">
        <Container className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
          <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-600">
              On this page
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {guide.sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="rounded text-ink-700 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="min-w-0 max-w-3xl">
            <Prose className="[&>section:first-child_h2]:mt-0">
              {guide.sections.map((s) => (
                <section key={s.id} aria-labelledby={s.id}>
                  <h2 id={s.id}>{s.heading}</h2>
                  {s.blocks.map((b, i) => (
                    <Block key={i} block={b} />
                  ))}
                </section>
              ))}
            </Prose>

            {related.length > 0 ? (
              <aside
                aria-labelledby="related-guides"
                className="mt-14 border-t border-ink-100 pt-8"
              >
                <h2 id="related-guides" className="text-lg font-semibold text-ink-900">
                  Related guides
                </h2>
                <ul className="mt-4 space-y-3">
                  {related.map((r) => (
                    <li key={r.slug}>
                      <a
                        href={`/guides/${r.slug}`}
                        className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
                      >
                        {r.title}
                      </a>
                      <Badge variant="neutral" className="ml-2">
                        {r.category}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm text-ink-600">
                  Stuck?{" "}
                  <a
                    href="/support"
                    className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
                  >
                    Contact support
                  </a>
                  .
                </p>
              </aside>
            ) : null}
          </article>
        </Container>
      </div>
    </PageShell>
  );
}
