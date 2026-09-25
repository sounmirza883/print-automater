import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BrowserFrameProps = {
  /** Text shown in the fake address bar. */
  url?: string;
  children: ReactNode;
  className?: string;
};

/** Decorative window chrome around a product mock. */
export function BrowserFrame({
  url = "app.printautomated.example/dashboard",
  children,
  className,
}: BrowserFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-white/15 bg-ink-900 shadow-2xl shadow-black/40 ring-1 ring-black/20",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-white/10 bg-ink-800 px-3 py-2.5">
        <div className="flex shrink-0 gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-cmyk-magenta" />
          <span className="size-2.5 rounded-full bg-cmyk-yellow" />
          <span className="size-2.5 rounded-full bg-cmyk-cyan" />
        </div>
        <div className="min-w-0 flex-1 truncate rounded-md bg-ink-900 px-3 py-1 text-center font-mono text-[11px] text-ink-200">
          {url}
        </div>
        <span className="hidden w-10 sm:block" aria-hidden="true" />
      </div>
      <div className="bg-ink-50 text-ink-900">{children}</div>
    </div>
  );
}
