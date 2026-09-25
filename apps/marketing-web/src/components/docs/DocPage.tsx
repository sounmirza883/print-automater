import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageHero, Prose } from "@/components/pages";
import { getPrevNext, docsPages } from "@/content/docs";
import { DocsNav } from "./DocsNav";

export type TocItem = { id: string; label: string };

/** Shared frame for every docs page: hero + sidebar + prose + on-this-page + prev/next. */
export function DocPage({
  href,
  title,
  lede,
  eyebrow = "Documentation",
  toc,
  children,
}: {
  href: string;
  title: ReactNode;
  lede: ReactNode;
  eyebrow?: string;
  toc?: readonly TocItem[];
  children: ReactNode;
}) {
  const { prev, next } = getPrevNext(href);
  const page = docsPages.find((p) => p.href === href);
  const crumbs =
    href === "/docs"
      ? [{ label: "Home", href: "/" }, { label: "Docs" }]
      : [
          { label: "Home", href: "/" },
          { label: "Docs", href: "/docs" },
          { label: page?.title ?? "Page" },
        ];

  return (
    <>
      <PageHero eyebrow={eyebrow} title={title} lede={lede} crumbs={crumbs} />
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem] xl:gap-12">
          <DocsNav />
          <article className="min-w-0">
            <Prose className="[&>:first-child]:mt-0">{children}</Prose>
            {prev || next ? (
              <nav
                aria-label="Previous and next pages"
                className="mt-14 grid gap-4 border-t border-ink-200 pt-8 sm:grid-cols-2"
              >
                {prev ? (
                  <Link
                    href={prev.href}
                    rel="prev"
                    className="group rounded-xl border border-ink-200 p-4 hover:border-brand-400"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-ink-600">
                      <ArrowLeft className="size-3.5" aria-hidden="true" /> Previous
                    </span>
                    <span className="mt-1 block font-semibold text-ink-900 group-hover:text-brand-700">
                      {prev.title}
                    </span>
                  </Link>
                ) : (
                  <span className="hidden sm:block" />
                )}
                {next ? (
                  <Link
                    href={next.href}
                    rel="next"
                    className="group rounded-xl border border-ink-200 p-4 text-right hover:border-brand-400 sm:col-start-2"
                  >
                    <span className="flex items-center justify-end gap-1.5 text-xs text-ink-600">
                      Next <ArrowRight className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="mt-1 block font-semibold text-ink-900 group-hover:text-brand-700">
                      {next.title}
                    </span>
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </article>
          {toc && toc.length > 0 ? (
            <aside aria-label="On this page" className="hidden xl:block">
              <div className="sticky top-24">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-600">
                  On this page
                </p>
                <ul className="mt-3 space-y-2 border-l border-ink-200 text-sm">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className="-ml-px block border-l border-transparent pl-3 text-ink-700 hover:border-brand-600 hover:text-brand-800"
                      >
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
