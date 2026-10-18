import { cn } from "@/lib/cn";
import { jobRows, type JobRow, type JobStatus } from "./data";
import { surface } from "./surface";

/** Pill styles follow the order lifecycle in one ink: waiting is outlined (solid rule when
 * it needs a person, dashed when it is only waiting), in production steps from grey to
 * solid charcoal, and done is outlined again. The label always carries the status. */
const statusStyle: Record<JobStatus, string> = {
  "Needs acceptance": "border border-ink-900 text-ink-950",
  "Awaiting payment": "border border-dashed border-ink-900 text-ink-950",
  Queued: "bg-ink-100 text-ink-700",
  Printing: "bg-ink-900 text-ink-50",
  Rerouted: "bg-ink-700 text-ink-50",
  "Quality check": "bg-ink-600 text-ink-50",
  "Ready for pickup": "border-2 border-ink-900 bg-white font-semibold text-ink-950",
  Collected: "border border-ink-200 text-ink-600",
  Failed: "border border-dashed border-ink-900 bg-ink-100 font-semibold text-ink-950",
};

export function StatusPill({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 text-xs font-medium",
        statusStyle[status],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 bg-current" />
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
        <thead className="border-b border-ink-200 bg-ink-50 text-xs text-ink-600">
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
        <tbody className="divide-y divide-ink-200">
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
