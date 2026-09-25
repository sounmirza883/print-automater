import Link from "next/link";
import type { ReactNode } from "react";
import { ApiClientError } from "@print-automated/api-client";
import { describeError, isForbidden } from "@/lib/api";
import { formatAge } from "@/lib/format";
import type { Tone } from "@/lib/job-status";

/** The console's small component kit: dense panels, big tabular numbers,
 * status pills that never rely on colour alone (each carries text), and
 * consistent loading / empty / error / forbidden states. */

export type { Tone };

const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-line",
  good: "bg-good-soft text-good-fg border-good/40",
  caution: "bg-caution-soft text-caution-fg border-caution/40",
  danger: "bg-danger-soft text-danger-fg border-danger/40",
  accent: "bg-accent-soft text-accent-fg border-accent/40",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line",
  good: "border-good/50",
  caution: "border-caution/50",
  danger: "border-danger/50",
  accent: "border-accent/50",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-quiet",
  good: "bg-good",
  caution: "bg-caution",
  danger: "bg-danger",
  accent: "bg-accent",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-good-fg",
  caution: "text-caution-fg",
  danger: "text-danger-fg",
  accent: "text-accent-fg",
};

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined && <p className="mt-0.5 text-muted">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  tone = "neutral",
  id,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;
  id?: string;
}): ReactNode {
  const border = TONE_BORDER[tone];
  return (
    <section
      id={id}
      aria-labelledby={title ? `${id ?? title}-h` : undefined}
      className={`rounded-lg border ${border} bg-panel ${className}`}
    >
      {title !== undefined && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 id={`${id ?? title}-h`} className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          {aside !== undefined && <div className="text-xs text-muted">{aside}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_PILL[tone]}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

/** One headline figure. With `href` the whole tile is a link (used for
 * counts that lead somewhere: blocked jobs -> the queue). */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  href?: string;
}): ReactNode {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        {label}
      </dt>
      <dd className={`num mt-1 text-2xl leading-8 font-semibold ${TONE_TEXT[tone]}`}>{value}</dd>
      {hint !== undefined && <dd className="mt-0.5 text-xs text-muted">{hint}</dd>}
    </>
  );
  const shell = "rounded-lg border border-line bg-panel px-4 py-3";
  return href !== undefined ? (
    <Link href={href} className={`${shell} block hover:border-accent`}>
      <dl>{body}</dl>
    </Link>
  ) : (
    <dl className={shell}>{body}</dl>
  );
}

export function StatGrid({ children }: { children: ReactNode }): ReactNode {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }): ReactNode {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

export function LoadingGrid({ label = "Loading" }: { label?: string }): ReactNode {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-line bg-panel px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children !== undefined && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  type?: "button" | "submit";
}): ReactNode {
  const styles = {
    primary: "bg-accent text-white border-transparent",
    secondary: "bg-panel text-ink border-line hover:border-muted",
    ghost: "bg-transparent text-ink border-transparent hover:bg-panel-2",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

/** 403: the API says this role may not see this. Shown in place of the
 * screen, not as a generic failure. */
export function ForbiddenState({ what = "this screen" }: { what?: string }): ReactNode {
  return (
    <div role="alert" className="rounded-lg border border-line bg-panel px-6 py-10 text-center">
      <p className="font-semibold">You don&apos;t have access to {what}</p>
      <p className="mx-auto mt-1 max-w-md text-muted">
        Your role at this business does not include it. If you think it should, ask the business
        owner to change your role.
      </p>
    </div>
  );
}

/** A failed load. 403 becomes the forbidden state; everything else offers a retry. */
export function ErrorState({
  error,
  onRetry,
  what,
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
}): ReactNode {
  if (isForbidden(error)) {
    return <ForbiddenState what={what} />;
  }
  return (
    <div role="alert" className="rounded-lg border border-danger/50 bg-danger-soft px-6 py-8">
      <p className="font-semibold text-danger-fg">Could not load {what ?? "this screen"}</p>
      <p className="mt-1">{describeError(error)}</p>
      {error instanceof ApiClientError && error.request_id !== "unknown" && (
        <p className="num mt-1 text-xs text-muted">Reference {error.request_id}</p>
      )}
      {onRetry !== undefined && (
        <div className="mt-4">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}

/** "Showing data from 2 min ago" when a background refresh fails but
 * older numbers are still on screen. */
export function StaleBanner({
  error,
  lastUpdated,
  onRetry,
}: {
  error: unknown;
  lastUpdated: number | null;
  onRetry: () => void;
}): ReactNode {
  if (error === null || error === undefined) {
    return null;
  }
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-caution/50 bg-caution-soft px-3 py-2"
    >
      <span>
        Live updates paused: {describeError(error)}
        {lastUpdated !== null && (
          <> Showing data from {formatAge(new Date(lastUpdated).toISOString())}.</>
        )}
      </span>
      <Button onClick={onRetry}>Retry now</Button>
    </div>
  );
}

/** Freshness + manual refresh, shown in a page header. */
export function LiveStatus({
  lastUpdated,
  refreshing,
  onRefresh,
}: {
  lastUpdated: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-xs text-muted" aria-live="off">
      <span className="num">
        {refreshing
          ? "Updating…"
          : lastUpdated !== null
            ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en", { timeStyle: "short" })}`
            : ""}
      </span>
      <Button onClick={onRefresh} disabled={refreshing}>
        Refresh
      </Button>
    </div>
  );
}

/** A labelled horizontal bar. The number is printed beside the bar, so
 * the bar is decoration for people who can see it and the figure is what
 * everyone else reads. */
export function BarList({
  rows,
  ariaLabel,
}: {
  rows: Array<{ label: string; value: number; tone?: Tone; href?: string }>;
  ariaLabel: string;
}): ReactNode {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return <p className="text-muted">Nothing to show.</p>;
  }
  return (
    <ul aria-label={ariaLabel} className="grid gap-2">
      {rows.map((row) => {
        const label = row.href ? (
          <Link href={row.href} className="underline-offset-2 hover:underline">
            {row.label}
          </Link>
        ) : (
          row.label
        );
        return (
          <li key={row.label} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3">
            <span className="truncate text-sm">{label}</span>
            <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-panel-2">
              <span
                className={`block h-full rounded-full ${TONE_DOT[row.tone ?? "accent"]}`}
                style={{ width: `${(row.value / max) * 100}%`, minWidth: row.value > 0 ? 4 : 0 }}
              />
            </span>
            <span className="num text-right text-sm font-medium">{row.value}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Used vs allowance. `role="meter"` with text alongside. */
export function Meter({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
}): ReactNode {
  const fraction = max <= 0 ? 0 : Math.min(1, value / max);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className="h-2 overflow-hidden rounded-full bg-panel-2"
    >
      <div
        className={`h-full rounded-full ${TONE_DOT[tone]}`}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}

/** Simple responsive table wrapper: scrolls sideways on a phone rather than squashing. */
export function DataTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: Array<string | { label: string; align: "right" }>;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
            {head.map((cell) => {
              const label = typeof cell === "string" ? cell : cell.label;
              const right = typeof cell !== "string" && cell.align === "right";
              return (
                <th
                  key={label}
                  scope="col"
                  className={`px-4 py-2 font-medium whitespace-nowrap ${right ? "text-right" : ""}`}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
