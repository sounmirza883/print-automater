import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { PageHero, PageShell, Prose } from "@/components/pages";
import { Container } from "@/components/ui";
import { LEGAL_NOTICE, type LegalDoc } from "@/content/legal";

/** Shared layout for legal-style pages: notice box, last-updated, table of contents, anchored sections. */
export function LegalDocument({
  doc,
  intro,
  outro,
}: {
  doc: LegalDoc;
  intro?: ReactNode;
  outro?: ReactNode;
}) {
  return (
    <PageShell>
      <PageHero
        eyebrow={doc.eyebrow}
        title={doc.title}
        lede={doc.lede}
        crumbs={[{ label: "Home", href: "/" }, { label: doc.title }]}
      />
      <Container className="py-12 md:py-16">
        <div
          role="note"
          className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
          <div className="text-sm leading-6">
            <p className="font-semibold">{LEGAL_NOTICE}</p>
            <p className="mt-0.5">
              Last updated: <time dateTime="2026-09-25">{doc.lastUpdated}</time>
            </p>
          </div>
        </div>

        {intro ? <div className="mt-10">{intro}</div> : null}

        <div className="mt-10 grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-16">
          <nav
            aria-label="Table of contents"
            className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
          >
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-ink-600">
              On this page
            </h2>
            <ol className="mt-3 space-y-1 border-l border-ink-200 text-sm">
              {doc.sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-ink-700 hover:border-brand-600 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <span className="mr-2 font-mono text-xs text-ink-500">{i + 1}.</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="min-w-0">
            <Prose className="[&>section:first-child_h2]:mt-0">
              {doc.sections.map((s, i) => (
                <section key={s.id} aria-labelledby={s.id}>
                  <h2 id={s.id}>
                    {i + 1}. {s.title}
                  </h2>
                  {s.paragraphs?.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                  {s.bullets ? (
                    <ul>
                      {s.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                  {s.table ? (
                    <div className="relative mt-6 overflow-x-auto">
                      <table className="min-w-[28rem]">
                        <caption className="pb-2 text-left text-sm font-medium text-ink-600">
                          {s.table.caption}
                        </caption>
                        <thead>
                          <tr>
                            {s.table.headers.map((h) => (
                              <th key={h} scope="col">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.table.rows.map((row) => (
                            <tr key={row.join("|")}>
                              {row.map((cell, ci) => (
                                <td key={`${cell}-${ci}`}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {s.after?.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </section>
              ))}
            </Prose>
            {outro}
          </article>
        </div>
      </Container>
    </PageShell>
  );
}
