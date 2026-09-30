import { cn } from "@/lib/cn";
import { jobRows, type JobRow, type JobStatus } from "./data";
import { surface } from "./surface";

/** Pill colours follow the order lifecycle: waiting (cyan, amber), in production (grey, blue,
 * violet, fuchsia), done (green, then outlined once collected). */
const statusStyle: Record<JobStatus, { pill: string; dot: string }> = {
  "Needs acceptance": { pill: "bg-cyan-50 text-cyan-800", dot: "bg-cyan-500" },
  "Awaiting payment": { pill: "bg-amber-50 text-amber-900", dot: "bg-amber-500" },
  Queued: { pill: "bg-ink-100 text-ink-700", dot: "bg-ink-400" },
  Printing: { pill: "bg-brand-50 text-brand-800", dot: "bg-brand-600" },
  Rerouted: { pill: "bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  "Quality check": { pill: "bg-fuchsia-50 text-fuchsia-800", dot: "bg-fuchsia-500" },
  "Ready for pickup": { pill: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  Collected: { pill: "bg-white text-ink-600 ring-1 ring-inset ring-ink-200", dot: "bg-ink-300" },
  Failed: { pill: "bg-rose-50 text-rose-800", dot: "bg-rose-500" },
};

export function StatusPill({ status, className }: { status: JobStatus; className?: string }) {
  const s = statusStyle[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        s.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {status}
    </span>
  );
}

export type JobQueueTableProps = {
  rows?: JobRow[];
  caption?: string;
  className?: string;
};

/** Columns appear as the table's own width allows (container queries), so the same table
 * works in a narrow overview column and full-width on the Orders screen. Order and Job are
 * two-line cells (id over customer, spec over page count) to keep rows compact. */
export function JobQueueTable({
  rows = jobRows,
  caption = "Production queue: current jobs with printer and status",
  className,
}: JobQueueTableProps) {
  return (
    <div className={cn(surface, "@container relative overflow-x-auto", className)}>
      <table className="w-full text-left text-xs @lg:text-[13px] @3xl:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-ink-100 bg-ink-50/70 text-xs text-ink-600">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium @md:px-4">
              Order
            </th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium @sm:table-cell">
              Job
            </th>
            <th scope="col" className="hidden px-3 py-2.5 font-medium @md:table-cell">
              Printer
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium @md:pr-4">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => (
            <tr key={r.order}>
              <th scope="row" className="px-3 py-2.5 font-normal @md:px-4">
                <span className="block font-mono text-xs font-semibold text-ink-900">
                  {r.order}
                </span>
                <span className="block whitespace-nowrap text-xs text-ink-600">{r.customer}</span>
              </th>
              <td className="hidden px-3 py-2.5 @sm:table-cell">
                <span className="block text-ink-800">{r.spec}</span>
                <span className="block font-mono text-xs tabular-nums text-ink-500">
                  {r.pages} pp
                </span>
              </td>
              <td
                className={cn(
                  "hidden whitespace-nowrap px-3 py-2.5 @md:table-cell",
                  r.printer === "Unassigned" ? "italic text-ink-500" : "text-ink-700",
                )}
              >
                {r.printer}
              </td>
              <td className="px-3 py-2.5 @md:pr-4">
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
