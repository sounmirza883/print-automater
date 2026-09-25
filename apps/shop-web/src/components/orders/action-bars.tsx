import type { ReactNode } from "react";
import type { Permission } from "@print-automated/types";
import type { ShopOrderJobSummary, ShopOrderResponse } from "@print-automated/api-client";
import { BlockedNote } from "@/components/blocked-note";
import { Button, Pill } from "@/components/ui";
import { formatMoney, humanizeEnum } from "@/lib/format";
import { jobStatusTone } from "@/lib/job-status";
import { availableJobActions, availableOrderActions } from "@/lib/order-actions";

export type OrderActionKind =
  | "accept"
  | "reject"
  | "recordPayment"
  | "retry"
  | "changePrinter"
  | "qualityCheck"
  | "markReady"
  | "complete"
  | "invoice";

export type JobActionKind =
  "reassign" | "pause" | "resume" | "recordFailure" | "reprint" | "resolveUnknown";

const ORDER_LABELS: Record<OrderActionKind, string> = {
  accept: "Accept order",
  reject: "Reject order",
  recordPayment: "Record payment",
  retry: "Retry printing",
  changePrinter: "Change printer",
  qualityCheck: "Record quality check",
  markReady: "Mark ready for collection",
  complete: "Complete order",
  invoice: "Download invoice",
};

const JOB_LABELS: Record<JobActionKind, string> = {
  reassign: "Assign printer",
  pause: "Pause",
  resume: "Resume",
  recordFailure: "Record failure reason",
  reprint: "Reprint",
  resolveUnknown: "Resolve",
};

/** The order-level buttons this role may use in this state. Pure and
 * presentational: the parent owns the requests and passes `busy` so every
 * button disables while any action is in flight. */
export function OrderActionBar({
  order,
  can,
  busy,
  onAction,
}: {
  order: Pick<ShopOrderResponse, "orderStatus">;
  can: (permission: Permission) => boolean;
  busy: boolean;
  onAction: (kind: OrderActionKind) => void;
}): ReactNode {
  const actions = availableOrderActions(order, can);
  const order_: OrderActionKind[] = [
    "accept",
    "reject",
    "recordPayment",
    "qualityCheck",
    "retry",
    "changePrinter",
    "markReady",
    "complete",
  ];
  const kinds = order_.filter((kind) => actions[kind]);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Order actions">
      {kinds.map((kind) => (
        <Button
          key={kind}
          variant={kind === "reject" ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => onAction(kind)}
        >
          {ORDER_LABELS[kind]}
        </Button>
      ))}
      {actions.invoice && (
        <Button disabled={busy} onClick={() => onAction("invoice")}>
          {ORDER_LABELS.invoice}
        </Button>
      )}
    </div>
  );
}

/** One live print job: state, printer, why it is parked, why it failed,
 * whether it is a reprint, and the job-level buttons this role may use. */
export function JobCard({
  job,
  order,
  can,
  busy,
  highlighted,
  onAction,
}: {
  job: ShopOrderJobSummary;
  order: Pick<ShopOrderResponse, "orderStatus" | "pricingSnapshot">;
  can: (permission: Permission) => boolean;
  busy: boolean;
  highlighted: boolean;
  onAction: (kind: JobActionKind, job: ShopOrderJobSummary) => void;
}): ReactNode {
  const actions = availableJobActions(job, order, can);
  const kinds = (Object.keys(JOB_LABELS) as JobActionKind[]).filter((kind) => actions[kind]);
  const currency = order.pricingSnapshot?.quote?.currency ?? "PKR";
  return (
    <li
      id={`job-${job.id}`}
      className={`grid gap-2 rounded-lg border bg-panel px-4 py-3 ${
        highlighted ? "border-accent ring-2 ring-accent/40" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill tone={jobStatusTone(job.status)}>{humanizeEnum(job.status)}</Pill>
        <span className="text-sm">
          {job.printerName !== null ? `on ${job.printerName}` : "no printer assigned"}
        </span>
        {job.blockedReason === "MANUAL_APPROVAL_REQUIRED" && (
          <Pill tone="danger">Held by late print</Pill>
        )}
        {highlighted && <span className="text-xs text-accent-fg">Linked from your alert</span>}
        <span className="num ml-auto text-xs text-muted">{job.id.slice(0, 8)}</span>
      </div>
      <BlockedNote reason={job.blockedReason} />
      {job.failureReason !== null && (
        <p className="text-sm">
          <span className="font-medium">Failure reason: </span>
          {humanizeEnum(job.failureReason)}
          {job.failureNote !== null && ` — ${job.failureNote}`}
        </p>
      )}
      {(job.status === "FAILED" || job.status === "TIMEOUT") && job.failureReason === null && (
        <p className="text-xs text-muted">No failure reason recorded yet.</p>
      )}
      {job.reprint !== null && (
        <p className="text-sm">
          <span className="font-medium">Reprint </span>
          of job <span className="num">{job.reprint.originalJobId.slice(0, 8)}</span> (
          {humanizeEnum(job.reprint.reason)}
          {job.reprint.additionalCostMinor > 0 &&
            `, extra ${formatMoney(job.reprint.additionalCostMinor, currency)}`}
          )
        </p>
      )}
      {kinds.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Job actions">
          {kinds.map((kind) => (
            <Button key={kind} disabled={busy} onClick={() => onAction(kind, job)}>
              {JOB_LABELS[kind]}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}
