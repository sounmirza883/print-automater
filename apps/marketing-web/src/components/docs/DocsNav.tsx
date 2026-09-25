"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { docsGroups, docsHome } from "@/content/docs";
import { cn } from "@/lib/cn";

function normalize(path: string | null): string {
  if (!path) return "";
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function NavList({ current }: { current: string }) {
  const link = (href: string, title: string) => {
    const active = current === href;
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "block rounded-md px-3 py-1.5 text-sm transition-colors",
          active
            ? "bg-brand-50 font-semibold text-brand-800"
            : "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
        )}
      >
        {title}
      </Link>
    );
  };
  return (
    <div className="space-y-6">
      <ul>
        <li>{link(docsHome.href, docsHome.title)}</li>
      </ul>
      {docsGroups.map((g) => (
        <div key={g.title}>
          <p className="px-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-600">
            {g.title}
          </p>
          <ul className="mt-2 space-y-0.5">
            {g.pages.map((p) => (
              <li key={p.href}>{link(p.href, p.title)}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Sticky sidebar on large screens, a native disclosure on small ones. */
export function DocsNav() {
  const current = normalize(usePathname());
  return (
    <nav aria-label="Documentation">
      <details className="group rounded-xl border border-ink-200 bg-white lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
          Documentation menu
          <ChevronDown
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-ink-200 p-3">
          <NavList current={current} />
        </div>
      </details>
      <div className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2">
        <NavList current={current} />
      </div>
    </nav>
  );
}
