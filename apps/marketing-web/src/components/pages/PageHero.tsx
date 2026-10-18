import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Container } from "@/components/ui";

export type Crumb = { label: string; href?: string };

/** Cream title band for inner pages, set apart from the header by its grey rule. */
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
      data-tone="light"
      className="relative overflow-hidden bg-ink-50 text-ink-900"
    >
      <Container className="relative py-14 md:py-20">
        {crumbs && crumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex flex-wrap items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-ink-600">
              {crumbs.map((c, i) => (
                <li key={c.label} className="flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight className="size-3.5" aria-hidden="true" /> : null}
                  {c.href ? (
                    <a
                      href={c.href}
                      className="text-ink-950 hover:underline hover:underline-offset-4"
                    >
                      {c.label}
                    </a>
                  ) : (
                    <span aria-current="page" className="text-ink-950">
                      {c.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {eyebrow ? (
          <p className="font-mono text-sm uppercase tracking-[0.12em] text-ink-600">{eyebrow}</p>
        ) : null}
        <h1
          id="page-title"
          className="mt-3 max-w-3xl text-balance text-4xl font-bold leading-[1.2] text-ink-950 md:text-5xl lg:text-6xl"
        >
          {title}
        </h1>
        {lede ? (
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-600">{lede}</p>
        ) : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </section>
  );
}
