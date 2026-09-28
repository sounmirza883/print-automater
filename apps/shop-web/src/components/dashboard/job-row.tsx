import Link from "next/link";
import type { ReactNode } from "react";
import { instructionSummary as sharedInstructionSummary } from "@print-automated/api-client";
import type { DashboardJob } from "@print-automated/types";
import { BlockedNote } from "@/components/blocked-note";
import { Pill } from "@/components/ui";
import { formatAge, humanizeEnum, priorityLabel } from "@/lib/format";
import { isHeldByLatePrint, jobStatusTone } from "@/lib/job-status";

/** What to load and how to print, on one line (shared with shop-mobile, 23.31). */
export function instructionSummary(job: DashboardJob): string {
  return sharedInstructionSummary(job.instructions);
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
