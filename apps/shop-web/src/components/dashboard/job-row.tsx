import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardJob } from "@print-automated/types";
import { BlockedNote } from "@/components/blocked-note";
import { Pill } from "@/components/ui";
import { formatAge, humanizeEnum, priorityLabel } from "@/lib/format";
import { isHeldByLatePrint, jobStatusTone } from "@/lib/job-status";

/** What to load and how to print, on one line: "A4 · Plain · Colour ·
 * Double-sided · 2 copies x 12 pp = 24 pp". This is the "required paper"
 * and "job instructions" of PRD 40. */
export function instructionSummary(job: DashboardJob): string {
  const { instructions: i } = job;
  const parts = [i.paperSize, i.paperType, i.color, i.sides, i.orientation, ...i.finishing]
    .filter((part): part is string => part !== null && part !== "")
    .map(humanizeEnum);
  const pages =
    i.copies > 1
      ? `${i.copies} copies × ${i.pagesPerCopy} pp = ${i.totalPages} pp`
      : `${i.totalPages} pp`;
  return [...parts, pages].join(" · ");
}

/** One job on the operator dashboard. The order number links to the
 * order (which lists its jobs); the paper and print settings sit right
 * under it so the person at the machine sees what to load. */
export function JobRow({
  job,
  showPrinter = true,
}: {
  job: DashboardJob;
  showPrinter?: boolean;
}): ReactNode {
  const priority = job.priority > 0 ? priorityLabel(job.priority) : null;
  return (
    <li className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={`/orders/${encodeURIComponent(job.orderId)}?job=${encodeURIComponent(job.id)}`}
          className="num font-semibold underline-offset-2 hover:underline"
        >
          {job.publicOrderNumber}
        </Link>
        <Pill tone={jobStatusTone(job.status)}>{humanizeEnum(job.status)}</Pill>
        {priority !== null && (
          <Pill tone={job.priority >= 20 ? "danger" : "caution"}>{priority} priority</Pill>
        )}
        {job.pausedAt !== null && <Pill tone="caution">Paused {formatAge(job.pausedAt)}</Pill>}
        {isHeldByLatePrint(job.blockedReason) && <Pill tone="danger">Held by late print</Pill>}
        {showPrinter && (
          <span className="text-xs text-muted">
            {job.printerName !== null ? `on ${job.printerName}` : "no printer assigned"}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{formatAge(job.updatedAt)}</span>
      </div>
      {job.documentFilename !== null && (
        <p className="truncate text-sm" title={job.documentFilename}>
          {job.documentFilename}
        </p>
      )}
      <p className="text-xs text-muted">
        <span className="font-medium text-ink">Load and print: </span>
        {instructionSummary(job)}
      </p>
      <BlockedNote reason={job.blockedReason} />
    </li>
  );
}
