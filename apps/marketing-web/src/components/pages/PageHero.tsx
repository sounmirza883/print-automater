import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Container } from "@/components/ui";

export type Crumb = { label: string; href?: string };

/** Dark title band for inner pages (the header above is dark, so this matches). */
export function PageHero({
  eyebrow,
  title,
  lede,
  crumbs,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  crumbs?: readonly Crumb[];
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="page-title"
      className="relative overflow-hidden bg-ink-950 text-white"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-brand-900/40 to-transparent"
      />
      <Container className="relative py-14 md:py-20">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-200">
              {crumbs.map((c, i) => (
                <li key={c.label} className="flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight className="size-3.5" aria-hidden="true" /> : null}
                  {c.href ? (
                    <a href={c.href} className="hover:text-white">
                      {c.label}
                    </a>
                  ) : (
                    <span aria-current="page" className="text-white">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {eyebrow ? (
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand-300">{eyebrow}</p>
        ) : null}
        <h1
          id="page-title"
          className="mt-3 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-5xl"
        >
          {title}
        </h1>
        {lede ? <p className="mt-5 max-w-2xl text-lg text-ink-200">{lede}</p> : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </section>
  );
}
