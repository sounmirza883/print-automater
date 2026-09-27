import { formatMoney, humanizeEnum } from "@/lib/format";

/** 23.19: how the API marks staff-typed text this role may not see. */
export const HIDDEN_TEXT = "[HIDDEN]";

/** Readable titles for the events staff meet most; anything else is humanised from its
 * code, so a new audit action still reads sensibly without a change here. */
const TITLES: Record<string, string> = {
  ORDER_CONFIRM_UPLOAD: "Document uploaded",
  ORDER_REQUEST_PAYMENT: "Payment requested",
  ORDER_CONFIRM_PAYMENT: "Payment confirmed",
  ORDER_FAIL_PAYMENT: "Payment failed",
  ORDER_ROUTE_TO_SHOP: "Sent to the business",
  ORDER_SHOP_ACCEPT: "Order accepted",
  ORDER_SHOP_REJECT: "Order rejected",
  ORDER_QUEUE_PRINT: "Queued for printing",
  ORDER_MARK_READY: "Marked ready for collection",
  ORDER_COMPLETE: "Order completed",
  ORDER_CANCEL: "Order cancelled",
  ORDER_EXPIRE: "Order expired",
  ORDER_QC_PASS: "Quality check passed",
  ORDER_QC_FAIL: "Quality check failed",
  ORDER_QC_REPRINT: "Quality check: needs reprint",
  ORDER_SYNC_JOBS: "Order status updated from its jobs",
  PRINT_JOB_ALLOCATE: "Job assigned to a printer",
  PRINT_JOB_UNALLOCATE: "Job taken off its printer",
  PRINT_JOB_QUEUE: "Job queued",
  PRINT_JOB_CLAIM: "Printer agent picked up the job",
  PRINT_JOB_PRINTED: "Job printed",
  PRINT_JOB_FAIL: "Job failed",
  PRINT_JOB_TIMEOUT: "Job timed out",
  PRINT_JOB_PAUSE: "Job paused",
  PRINT_JOB_RESUME: "Job resumed",
  PRINT_JOB_RESUME_QUEUE: "Job resumed",
  PRINT_JOB_HOLD: "Job held after a late print report",
  PRINT_JOB_SUPERSEDE: "Job replaced",
  PRINT_JOB_LATE_REPORT: "Late report from the printer agent",
  PRINT_JOB_LATE_PRINT_SUCCESSOR: "Late print reported for a replaced job",
  PRINT_JOB_LATE_PRINT_ACKNOWLEDGED: "Late print acknowledged",
  JOB_REASSIGNED: "Job moved to another printer",
  JOB_OPERATOR_ASSIGNED: "Operator assigned",
  JOB_FAILURE_REASON_RECORDED: "Failure reason recorded",
  JOB_REPRINT_CREATED: "Reprint created",
  INVENTORY_SHORTFALL: "Not enough paper in stock for this job",
  INVENTORY_CONSUMPTION_FAILED: "Paper stock could not be updated for this job",
  PAYMENT_STATUS_CHANGED: "Payment status changed",
  MANUAL_PAYMENT_RECORDED: "Payment recorded at the counter",
  PAYMENT_RECONCILIATION_DIVERGENCE: "Payment provider disagrees with our record",
  REFUND_SUCCEEDED: "Refund completed",
  REFUND_FAILED: "Refund failed",
  DELIVERY_DETAILS_SAVED: "Delivery details saved",
  DELIVERY_STATUS_CHANGED: "Delivery status changed",
  INVOICE_DOWNLOADED: "Invoice downloaded",
};

export function historyTitle(action: string): string {
  return TITLES[action] ?? humanizeEnum(action);
}

export interface HistoryDetail {
  label: string;
  value: string;
  hidden?: true;
}

const LABELS: Record<string, string> = {
  from: "From",
  to: "To",
  reason: "Reason",
  note: "Note",
  comment: "Comment",
  trackingNumber: "Tracking number",
  printerName: "Printer",
  courier: "Courier",
  blockedReason: "Waiting because",
  failureReason: "Failure reason",
  previousReason: "Previous reason",
  reprintReason: "Reprint reason",
  resolution: "Resolution",
  result: "Result",
  status: "Status",
  attempt: "Attempt",
  shortfallSheets: "Sheets short",
  requiredSheets: "Sheets needed",
  consumedSheets: "Sheets taken from stock",
  amountMinor: "Amount",
  feeMinor: "Fee",
  additionalCostMinor: "Extra cost",
};

/** The allowlisted metadata of one history row as label/value pairs. Identifiers are left
 * out (they mean nothing on screen); `[HIDDEN]` becomes an explicit "hidden for your role";
 * money fields are formatted in `currency`. Never throws on unexpected shapes. */
export function historyDetails(metadata: unknown, currency: string): HistoryDetail[] {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const details: HistoryDetail[] = [];
  for (const [key, raw] of Object.entries(metadata as Record<string, unknown>)) {
    if (/Ids?$/.test(key) || key === "recordedBy" || key === "currency") {
      continue;
    }
    const label = LABELS[key] ?? humanizeEnum(key.replace(/([a-z])([A-Z])/g, "$1_$2"));
    if (raw === HIDDEN_TEXT) {
      details.push({ label, value: "hidden for your role", hidden: true });
    } else if (typeof raw === "number") {
      details.push({
        label,
        value: key.endsWith("Minor") ? formatMoney(raw, currency) : String(raw),
      });
    } else if (typeof raw === "boolean") {
      details.push({ label, value: raw ? "yes" : "no" });
    } else if (typeof raw === "string" && raw !== "") {
      details.push({ label, value: /^[A-Z][A-Z0-9_]*$/.test(raw) ? humanizeEnum(raw) : raw });
    }
  }
  return details;
}
