import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Horizontal scroll lives inside this region, never on the page. */
export function TableScroll({
  label,
  children,
  minWidth = "min-w-[34rem]",
}: {
  label: string;
  children: ReactNode;
  minWidth?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative mt-6 overflow-x-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [&_table]:mt-0"
    >
      <table className={cn("w-full", minWidth)}>{children}</table>
    </div>
  );
}

/** Highlighted note. `planned` marks anything that is designed but not built yet. */
export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: "note" | "planned" | "warning";
  title: string;
  children: ReactNode;
}) {
  const styles = {
    note: "border-brand-200 bg-brand-50",
    planned: "border-amber-300 bg-amber-50",
    warning: "border-red-300 bg-red-50",
  } as const;
  return (
    <aside className={cn("mt-6 rounded-xl border p-4", styles[tone])}>
      <p className="font-semibold text-ink-900">{title}</p>
      <div className="mt-1 text-sm leading-6 text-ink-800 [&_p]:mt-2 [&_p:first-child]:mt-0">
        {children}
      </div>
    </aside>
  );
}

export function PlannedBadge() {
  return (
    <span className="ml-2 inline-block rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 align-middle font-mono text-xs font-medium uppercase tracking-wide text-amber-900">
      Planned
    </span>
  );
}

export type Endpoint = { method: string; path: string; access: string; purpose: string };

export function EndpointTable({ label, rows }: { label: string; rows: readonly Endpoint[] }) {
  return (
    <TableScroll label={label} minWidth="min-w-[44rem]">
      <thead>
        <tr>
          <th scope="col">Method</th>
          <th scope="col">Path</th>
          <th scope="col">Access</th>
          <th scope="col">Purpose</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.method} ${r.path}`}>
            <th scope="row" className="font-mono text-xs">
              {r.method}
            </th>
            <td>
              <code>{r.path}</code>
            </td>
            <td>{r.access}</td>
            <td>{r.purpose}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
}
