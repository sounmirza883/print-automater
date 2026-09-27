import { Permission } from "@print-automated/types";
import type { ShopOrderJobSummary, ShopOrderResponse } from "./types.js";

/** 23.30: shared by shop-web and shop-mobile, so both clients offer the same actions from
 * the same rules (moved here from shop-web's lib/order-actions.ts unchanged). */

/** What a person may DO on an order and its jobs, from the order's state
 * and the permissions their role holds at the business. This decides
 * which buttons are shown; the API re-checks every one (permission, state
 * machine) and answers with an exact `error_code` each app words for people, so a stale
 * screen can only ever produce an explained refusal. */
export type Can = (permission: Permission) => boolean;

/** Order statuses in which a job may be reprinted (mirrors the API's
 * REPRINTABLE_ORDER_STATUSES; the API is authoritative). */
const REPRINTABLE_ORDER_STATUSES = new Set([
  "QUEUED_FOR_PRINT",
  "PRINTING",
  "PRINTED",
  "PRINT_FAILED",
  "PRINT_STATUS_UNKNOWN",
  "PREPARING",
  "ASSIGNED",
  "PAUSED",
  "QUALITY_CHECK",
  "READY_FOR_COLLECTION",
]);

const REASSIGNABLE_JOB_STATUSES = new Set([
  "CREATED",
  "WAITING",
  "QUEUED",
  "PAUSED",
  "FAILED",
  "TIMEOUT",
]);

export interface OrderActions {
  accept: boolean;
  reject: boolean;
  recordPayment: boolean;
  retry: boolean;
  changePrinter: boolean;
  qualityCheck: boolean;
  markReady: boolean;
  complete: boolean;
  invoice: boolean;
}

export function availableOrderActions(
  order: Pick<ShopOrderResponse, "orderStatus">,
  can: Can,
): OrderActions {
  const edit = can(Permission.EDIT_ORDERS);
  const status = order.orderStatus;
  return {
    accept: edit && status === "WAITING_FOR_SHOP",
    reject: edit && status === "WAITING_FOR_SHOP",
    recordPayment: edit && status === "PAYMENT_PENDING",
    retry: edit && status === "PRINT_FAILED",
    changePrinter: edit && status === "PRINT_FAILED",
    qualityCheck: can(Permission.QUALITY_CHECK) && status === "QUALITY_CHECK",
    markReady: edit && status === "PRINTED",
    complete: edit && status === "READY_FOR_COLLECTION",
    invoice: can(Permission.VIEW_ORDERS),
  };
}

/** 23.26: a job still being worked on can have its operator changed; a finished one can't. */
const OPERATOR_ASSIGNABLE_JOB_STATUSES = new Set([
  "CREATED",
  "WAITING",
  "QUEUED",
  "CLAIMED",
  "PRINTING",
  "PAUSED",
]);

export interface JobActions {
  reassign: boolean;
  assignOperator: boolean;
  pause: boolean;
  resume: boolean;
  recordFailure: boolean;
  reprint: boolean;
  resolveUnknown: boolean;
}

export function availableJobActions(
  job: Pick<ShopOrderJobSummary, "status" | "reprint">,
  order: Pick<ShopOrderResponse, "orderStatus">,
  can: Can,
): JobActions {
  const status = job.status;
  return {
    reassign: can(Permission.ASSIGN_JOBS) && REASSIGNABLE_JOB_STATUSES.has(status),
    assignOperator: can(Permission.ASSIGN_JOBS) && OPERATOR_ASSIGNABLE_JOB_STATUSES.has(status),
    pause: can(Permission.PAUSE_JOBS) && (status === "WAITING" || status === "QUEUED"),
    resume: can(Permission.PAUSE_JOBS) && status === "PAUSED",
    recordFailure:
      can(Permission.RECORD_JOB_FAILURE) && (status === "FAILED" || status === "TIMEOUT"),
    reprint:
      can(Permission.REPRINT_JOBS) &&
      status === "PRINTED" &&
      REPRINTABLE_ORDER_STATUSES.has(order.orderStatus),
    resolveUnknown: can(Permission.EDIT_ORDERS) && status === "UNKNOWN",
  };
}

/** A failed quality check leaves nothing to "retry" (the API answers
 * NO_RETRYABLE_ITEMS); the way forward is a reprint. */
export function shouldSteerToReprint(
  order: Pick<ShopOrderResponse, "qualityCheckStatus" | "orderStatus">,
): boolean {
  return order.qualityCheckStatus === "FAILED" && order.orderStatus !== "COMPLETED";
}
