import { cn } from "@/lib/cn";

export type ContextBadge = { text: string; tone: "live" | "warning" | "neutral" };

const badgeTone: Record<ContextBadge["tone"], { pill: string; dot: string }> = {
  live: { pill: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  warning: { pill: "bg-amber-50 text-amber-900 ring-amber-600/25", dot: "bg-amber-500" },
  neutral: { pill: "bg-ink-50 text-ink-700 ring-ink-200", dot: "bg-ink-400" },
};

export type ContextBarProps = {
  title: string;
  subtitle: string;
  badge?: ContextBadge;
};

/** The app's page header: screen title, a one-line context, and a status badge. */
export function ContextBar({ title, subtitle, badge }: ContextBarProps) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-ink-100 bg-white px-4 py-2 @2xl/main:px-5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        <p className="text-xs text-ink-600">{subtitle}</p>
      </div>
      {badge ? (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
            badgeTone[badge.tone].pill,
          )}
        >
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", badgeTone[badge.tone].dot)}
          />
          {badge.text}
        </span>
      ) : null}
    </div>
  );
}
