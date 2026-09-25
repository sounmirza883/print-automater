import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Readable long-form typography for docs, legal and blog content (no typography plugin needed). */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-none text-base leading-7 text-ink-700",
        "[&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink-900",
        "[&_h3]:mt-8 [&_h3]:scroll-mt-24 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink-900",
        "[&_p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6",
        "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
        "[&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-brand-900",
        "[&_strong]:font-semibold [&_strong]:text-ink-900",
        "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-ink-100 [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:text-ink-900",
        "[&_table]:mt-6 [&_table]:w-full [&_table]:text-left [&_table]:text-sm [&_th]:border-b [&_th]:border-ink-200 [&_th]:py-2 [&_th]:pr-4 [&_th]:font-semibold [&_th]:text-ink-900 [&_td]:border-b [&_td]:border-ink-100 [&_td]:py-2 [&_td]:pr-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
