/** Precise, actionable wording for the API's `error_code`s, so an action
 * that fails says WHY in terms of what the person can do next, rather
 * than echoing a generic "Request failed". Unknown codes fall back to the
 * server's own message (already human-readable for validation errors).
 * Duck-typed on `error_code` so it is unit-testable without the client. */

interface CodedError {
  status?: number;
  error_code?: string;
  message?: string;
}

const COPY: Record<string, string> = {
  RATE_LIMITED:
    "You are searching too quickly (the limit is 60 searches a minute). Wait a few seconds and try again.",
  FORBIDDEN: "Your role at this business does not allow that.",
  ILLEGAL_ORDER_TRANSITION:
    "This order has already moved on, so that action no longer applies. Refresh to see where it is now.",
  ILLEGAL_JOB_TRANSITION:
    "This job has already moved on, so that action no longer applies. Refresh to see where it is now.",
  ORDER_NOT_ACTIVE: "This order is no longer active, so its jobs cannot be changed.",
  ORDER_NOT_AWAITING_PAYMENT: "This order is not waiting for payment.",
  PAYMENT_NOT_CONFIRMED: "The order has no confirmed payment yet.",
  DOCUMENT_NOT_READY: "The customer's document is not ready to print yet.",
  NO_PRINTER_AVAILABLE:
    "No printer can take this job right now. Bring a printer online, restock paper, or pick one by hand.",
  NO_RETRYABLE_ITEMS:
    "Nothing here can be retried. If a quality check failed, use Reprint instead.",
  PRINTER_CAPABILITY_MISMATCH:
    "That printer cannot do this job (paper size, colour or double-sided). Pick a printer that supports it.",
  PRINTER_NOT_AVAILABLE:
    "That printer is not available (offline, disabled or out of paper). Pick another printer.",
  PRINTER_OFFLINE: "That printer is offline. Pick another printer or bring it back online.",
  PRINTER_DISABLED: "That printer is disabled. Enable it or pick another printer.",
  PRINTER_HAS_NO_AGENT: "That printer has no print agent paired, so it cannot receive jobs.",
  PAGE_LIMIT_REACHED: "That printer has reached its page limit.",
  NO_PAPER: "That printer is out of the paper this job needs. Restock it or pick another printer.",
  JOB_NOT_REASSIGNABLE: "This job can no longer be moved to another printer.",
  REASSIGN_CONFLICT:
    "The job changed while you were reassigning it. Refresh and try again if it still needs moving.",
  JOB_NOT_RESUMABLE: "This job is not paused, so there is nothing to resume.",
  RESUME_TARGET_STALE:
    "The printer this job was paused on is no longer suitable. Choose a printer to resume on.",
  LATE_PRINT_ACK_REQUIRED:
    "A printer reported this job printed after it was given up on, so paper may already have come out. Check the output tray, then confirm to resume.",
  JOB_NOT_FAILED: "Only a failed or timed-out job can be given a failure reason.",
  QUALITY_CHECK_REQUIRED:
    "This order needs a quality check first. Record a Passed verdict before marking it ready.",
  REPRINT_JOB_INVALID: "That job cannot be reprinted (only a printed job can).",
  REPRINT_ALREADY_EXISTS: "A reprint of this job already exists. Open it from the order's jobs.",
  REPRINT_ITEM_IN_PROGRESS:
    "This item still has a job in progress. Wait for it to finish or resolve it before reprinting.",
  REPRINT_IN_PROGRESS:
    "A reprint of this order is still in progress, so the order cannot be completed yet.",
  ORDER_NOT_REPRINTABLE: "This order is in a state where reprinting is not allowed.",
  IDEMPOTENCY_KEY_IN_PROGRESS:
    "That request is already being processed. Wait a moment and refresh; do not submit it again.",
  UNKNOWN_JOB_ID_REQUIRED: "Choose which unresolved job you are resolving.",
  INVALID_OPERATOR:
    "That person does not work here as an operator (any more). Refresh and pick someone else.",
  DELIVERY_NOT_FOUND: "This order has no delivery record yet.",
  DELIVERY_NOT_ALLOWED: "Delivery details cannot be changed for this order.",
  DELIVERY_CLOSED: "This delivery is already closed (delivered, failed or cancelled).",
  DELIVERY_STATUS_INVALID: "That delivery status change is not allowed from the current status.",
  DELIVERY_COURIER_REQUIRED: "Enter a courier before handing the delivery over.",
  DELIVERY_ORDER_NOT_READY: "The order is not ready to be sent out for delivery yet.",
  PRINTER_HAS_ACTIVE_JOB:
    "This printer has an active print job, so it cannot be removed. Wait for it to finish, or disable the printer instead.",
  INSUFFICIENT_STOCK:
    "There is not enough stock for that. The movement would take the quantity below zero.",
  STOCK_OVERFLOW: "That would push the quantity past the largest number the system can hold.",
  INVENTORY_SKU_TAKEN: "Another stock item already uses that SKU. Choose a different one.",
  INVENTORY_MAX_BELOW_MIN: "The maximum quantity cannot be below the minimum.",
  INVENTORY_ITEM_NOT_FOUND: "That stock item no longer exists.",
  INVENTORY_ITEM_INACTIVE: "That stock item is inactive. Reactivate it or choose another.",
  SUPPLIER_NOT_FOUND: "That supplier no longer exists.",
  SUPPLIER_INACTIVE: "That supplier is inactive. Reactivate it or choose another supplier.",
  SUPPLIER_PRODUCT_EXISTS:
    "This supplier already supplies that item. Edit the existing link instead.",
  SUPPLIER_PRODUCT_NOT_FOUND: "That supplier link no longer exists.",
  PURCHASE_ORDER_NOT_FOUND: "That purchase order no longer exists.",
  PURCHASE_ORDER_LINE_NOT_FOUND: "One of the lines is not part of this purchase order.",
  PURCHASE_ORDER_INVALID_STATE:
    "This purchase order is not in a state that allows that (for example, it was already received or cancelled). Refresh to see where it is now.",
  PURCHASE_ORDER_TOTAL_TOO_LARGE:
    "The order total is too large. Reduce the quantities or unit costs.",
  SETTINGS_VERSION_CONFLICT:
    "Someone else changed these settings while you were editing. Reload to see their changes, then apply yours again.",
  RULE_VERSION_CONFLICT:
    "Someone else changed this rule while you were editing. Reload to see their changes, then try again.",
  RULE_LIMIT_REACHED: "A business can have at most 50 printer rules. Delete one first.",
  RULE_ORDER_MISMATCH:
    "The list of rules changed while you were reordering. Reload and reorder again.",
  RULE_PRINTER_INVALID: "A chosen printer does not belong to this business.",
  INVITE_RATE_LIMITED:
    "Too many invitations just now (from you, or to this address). Wait a while, up to an hour, and try again.",
  SHOP_STAFF_INVITE_NOT_PENDING:
    "That invitation was already accepted or cancelled. The list has been refreshed.",
  CANNOT_REMOVE_LAST_OWNER:
    "A business must always have an owner. Make someone else an owner before removing or changing this person.",
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  UPSTREAM_UNREACHABLE: "The service is unreachable right now. Try again in a moment.",
  CROSS_ORIGIN_BLOCKED: "That request was blocked for safety. Reload the page and try again.",
};

/** Codes that mean "conflict with the current state": the screen should
 * refresh what it shows so the person sees the real state. */
const STALE_STATE_CODES = new Set([
  "ILLEGAL_ORDER_TRANSITION",
  "ILLEGAL_JOB_TRANSITION",
  "ORDER_NOT_ACTIVE",
  "JOB_NOT_RESUMABLE",
  "JOB_NOT_REASSIGNABLE",
  "REASSIGN_CONFLICT",
  "REPRINT_ALREADY_EXISTS",
  "JOB_NOT_FAILED",
  "PURCHASE_ORDER_INVALID_STATE",
  "SETTINGS_VERSION_CONFLICT",
  "RULE_VERSION_CONFLICT",
  "RULE_ORDER_MISMATCH",
  "SHOP_STAFF_INVITE_NOT_PENDING",
]);

function coded(error: unknown): CodedError {
  return typeof error === "object" && error !== null ? (error as CodedError) : {};
}

export function errorCodeOf(error: unknown): string | undefined {
  return coded(error).error_code;
}

/** Words for a failure: exact copy for known codes, the server's message
 * for others, a connectivity message when there was no response at all. */
export function errorMessageFor(error: unknown): string {
  const { status, error_code: code, message } = coded(error);
  // A 403 from a permission guard is generic; a 403 the service throws itself
  // (for example "Only an existing owner can grant the SHOP_OWNER role.") is precise.
  if (
    code === "FORBIDDEN" &&
    typeof message === "string" &&
    message.length > 0 &&
    !message.startsWith("Insufficient permission")
  ) {
    return message;
  }
  if (code !== undefined && COPY[code] !== undefined) {
    return COPY[code];
  }
  if (status === 502 || status === 503 || status === 504) {
    return COPY.UPSTREAM_UNREACHABLE as string;
  }
  if (status === 403) {
    return COPY.FORBIDDEN as string;
  }
  if (status === 429) {
    return COPY.RATE_LIMITED as string;
  }
  if (typeof status === "number" && typeof message === "string" && message.length > 0) {
    return message;
  }
  return "Could not reach the server. Check your connection and try again.";
}

/** True when the failure means the screen's data is out of date. */
export function isStaleStateError(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code !== undefined && STALE_STATE_CODES.has(code);
}

export type ActionFailure =
  { kind: "message"; text: string; refresh: boolean } | { kind: "confirm-late-print" };

/** How a failed job/order action should be handled: a resume that hit
 * LATE_PRINT_ACK_REQUIRED becomes a confirmation dialog (the ONLY way
 * to proceed is to resend with `acknowledgeLatePrint: true`); everything
 * else is a precise message, refreshing the screen when its data is stale. */
export function interpretActionFailure(error: unknown): ActionFailure {
  if (errorCodeOf(error) === "LATE_PRINT_ACK_REQUIRED") {
    return { kind: "confirm-late-print" };
  }
  return { kind: "message", text: errorMessageFor(error), refresh: isStaleStateError(error) };
}
