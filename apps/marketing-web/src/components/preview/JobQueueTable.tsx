import { cn } from "@/lib/cn";
import { jobRows, type JobRow, type JobStatus } from "./data";

const statusClass: Record<JobStatus, string> = {
  Printing: "bg-brand-50 text-brand-800",
  Queued: "bg-ink-100 text-ink-700",
  "Ready for pickup": "bg-emerald-50 text-emerald-800",
  "Awaiting payment": "bg-amber-50 text-amber-900",
  Rerouted: "bg-violet-50 text-violet-800",
  Failed: "bg-rose-50 text-rose-800",
};

export type JobQueueTableProps = {
  rows?: JobRow[];
  caption?: string;
  className?: string;
};

export function JobQueueTable({
  rows = jobRows,
  caption = "Production queue: current jobs with printer and status",
  className,
}: JobQueueTableProps) {
  return (
    <div
      className={cn(
        "relative overflow-x-auto rounded-lg border border-ink-100 bg-white",
        className,
      )}
    >
      <table className="w-full text-left text-xs sm:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-ink-100 bg-ink-50 text-xs text-ink-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Order
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
              Job
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
              Pages
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              Printer
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => (
            <tr key={r.order}>
              <th scope="row" className="px-3 py-2.5 font-normal">
                <span className="block font-mono text-xs font-medium text-ink-900">{r.order}</span>
                <span className="block text-xs text-ink-600">{r.customer}</span>
              </th>
              <td className="hidden px-3 py-2.5 text-ink-700 md:table-cell">{r.spec}</td>
              <td className="hidden px-3 py-2.5 text-right font-mono text-ink-700 sm:table-cell">
                {r.pages}
              </td>
              <td className="hidden px-3 py-2.5 text-ink-700 sm:table-cell">{r.printer}</td>
              <td className="px-3 py-2.5">
                <span
                  className={cn(
                    "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                    statusClass[r.status],
                  )}
                >
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
