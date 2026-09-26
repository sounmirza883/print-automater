import { redactMetadata } from "@print-automated/backend-shared";

/** Keys whose values must never reach the shop-facing order timeline: credentials and
 * payment links/identifiers (matched loosely, on purpose) and the personal data the
 * timeline has no reason to show (delivery address, contact details). The audit writers
 * already run `redactMetadata`; this is the read-side second line of defence, because an
 * audit row is append-only and a future writer could put something in it. */
const HISTORY_DENY_KEY =
  /address|checkout|url|card|iban|account|secret|password|token|signature|authorization|privatekey|providerpayment|providerrefund|phone|email/i;

const REDACTED = "[REDACTED]";

export function sanitizeHistoryMetadata(value: unknown): unknown {
  const redacted = redactMetadata(value);
  return strip(redacted);
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(strip);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        HISTORY_DENY_KEY.test(key) ? REDACTED : strip(val),
      ]),
    );
  }
  return value;
}
