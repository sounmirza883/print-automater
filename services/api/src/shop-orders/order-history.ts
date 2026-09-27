/** 23.19: what of an audit row's metadata the shop-facing order timeline may show. An
 * ALLOWLIST, not a denylist (23.13's key denylist missed keys such as `mobile` or `street` and
 * never looked at values): a key that is not listed here is dropped, so a future writer's new
 * fields stay out of the timeline until someone decides they belong in it. Audit rows are
 * append-only, so this read side is where the timeline's data minimisation lives.
 *
 * Three kinds of listed key:
 *  - STRUCTURED: ids, statuses, enum codes, amounts, counts, flags. A string must look like an
 *    identifier or code (no spaces, no `@`/`+`), so free text or contact data can never ride
 *    along under one of these names; anything else is dropped.
 *  - LABEL: business labels (a printer's or courier's name) -- short plain text for every role.
 *  - TEXT: what staff type freely (a reason, a note). An UPPER_SNAKE enum code is shown to
 *    everyone; anything else may hold a customer's phone number or address, so it is shown only
 *    to roles that may already see customer contact details (MANAGE_DELIVERY, the same line the
 *    order detail's contact block uses) and is `[HIDDEN]` for the others. */
const STRUCTURED_KEYS = new Set([
  // transitions and outcomes
  "from",
  "to",
  "event",
  "status",
  "localStatus",
  "providerOutcome",
  "provider",
  "resolution",
  "result",
  "source",
  "trigger",
  "automatic",
  "held",
  "late",
  "reported",
  "explicitPrinter",
  "acknowledgedLatePrint",
  "created",
  "changedFields",
  // ids
  "orderId",
  "jobId",
  "printJobId",
  "jobIds",
  "previousJobId",
  "supersededJobId",
  "successorJobId",
  "originalJobId",
  "printerId",
  "previousPrinterId",
  "newPrinterId",
  "fromPrinterId",
  "toPrinterId",
  "operatorId",
  "paymentId",
  "refundId",
  "recordedBy",
  "movementId",
  "alertId",
  "inventoryItemId",
  // reasons that are always enum codes
  "successorStatus",
  "blockedReason",
  "failureReason",
  "previousReason",
  "reprintReason",
  // money and quantities
  "amountMinor",
  "feeMinor",
  "additionalCostMinor",
  "currency",
  "paperSize",
  "paperType",
  "requiredSheets",
  "consumedSheets",
  "shortfallSheets",
  "quantityDelta",
  "quantityAfter",
  "attempt",
  "priority",
  "type",
]);

const LABEL_KEYS = new Set(["printerName", "courier"]);

const TEXT_KEYS = new Set(["reason", "note", "comment", "trackingNumber"]);

const ID_OR_CODE = /^[A-Za-z0-9_.:-]{1,120}$/;
const ENUM_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const LABEL_MAX = 100;
const TEXT_MAX = 500;

export const HISTORY_TEXT_HIDDEN = "[HIDDEN]";

export interface HistoryMetadataOptions {
  /** True only when the caller's role at the order's business holds MANAGE_DELIVERY. */
  includeFreeText: boolean;
}

export function sanitizeHistoryMetadata(
  value: unknown,
  options: HistoryMetadataOptions,
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (STRUCTURED_KEYS.has(key)) {
      const kept = structured(val);
      if (kept !== undefined) out[key] = kept;
    } else if (LABEL_KEYS.has(key)) {
      if (val === null) out[key] = null;
      else if (typeof val === "string") out[key] = plainText(val, LABEL_MAX);
    } else if (TEXT_KEYS.has(key)) {
      if (val === null) out[key] = null;
      else if (typeof val === "string") {
        out[key] = ENUM_CODE.test(val)
          ? val
          : options.includeFreeText
            ? plainText(val, TEXT_MAX)
            : HISTORY_TEXT_HIDDEN;
      }
    }
  }
  return out;
}

function structured(val: unknown): unknown {
  if (val === null || typeof val === "number" || typeof val === "boolean") return val;
  if (typeof val === "string") return ID_OR_CODE.test(val) ? val : undefined;
  if (Array.isArray(val)) {
    // All or nothing: a partly-dropped list would misstate what happened.
    return val.every((item) => typeof item === "string" && ID_OR_CODE.test(item)) ? val : undefined;
  }
  return undefined;
}

/** Control characters, Unicode line/paragraph separators and bidi controls become spaces
 * (the text is displayed, never interpreted); length is capped. */
function plainText(text: string, max: number): string {
  return Array.from(text, (ch) => {
    const code = ch.codePointAt(0)!;
    const unsafe =
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    return unsafe ? " " : ch;
  })
    .join("")
    .slice(0, max);
}
