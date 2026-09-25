import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { Badge, Container } from "@/components/ui";
import { tutorials } from "@/content/tutorials";

export const metadata: Metadata = {
  title: "Tutorials",
  description:
    "Written step-by-step tutorials for print shops: your first order end to end, a day at the counter, inviting your team and reading your first report.",
};

export default function TutorialsPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Tutorials"
        title="Step-by-step tutorials"
        lede="Written walkthroughs you can follow with your shop open in another tab. Each one lists the time it should take."
        crumbs={[{ label: "Home", href: "/" }, { label: "Tutorials" }]}
      />

      <div className="bg-white py-14 md:py-20">
        <Container className="grid gap-12 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-16">
          <nav aria-label="Tutorials" className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-600">
              In this page
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              {tutorials.map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    className="rounded text-ink-700 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    {t.title}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-ink-600">
              Need a single task instead?{" "}
              <a
                href="/guides"
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-900"
              >
                Browse guides
              </a>
              .
            </p>
          </nav>

          <div className="min-w-0 max-w-3xl space-y-16">
            {tutorials.map((t) => (
              <section
                key={t.id}
                id={t.id}
                aria-labelledby={`${t.id}-title`}
                className="scroll-mt-24"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand">
                    <Clock aria-hidden="true" className="size-3" />
                    About {t.minutes} min
                  </Badge>
                  <Badge variant="outline">{t.audience}</Badge>
                </div>
                <h2
                  id={`${t.id}-title`}
                  className="mt-4 text-2xl font-semibold tracking-tight text-ink-900"
                >
                  {t.title}
                </h2>
                <p className="mt-2 text-ink-700">{t.summary}</p>
                <ol className="mt-6 space-y-4">
                  {t.steps.map((s, i) => (
                    <li
                      key={s.title}
                      className="flex gap-4 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 font-mono text-sm font-semibold text-white"
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-ink-900">{s.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-ink-700">{s.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </Container>
      </div>
    </PageShell>
  );
}
