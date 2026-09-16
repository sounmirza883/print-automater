import type pino from "pino";
import type { BackendClient } from "./backend-client.js";

export type ReportedJobStatus = "PRINTING" | "PRINTED" | "FAILED" | "UNKNOWN";

export interface ReportStatusOptions {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  /** Bounds retries for tests; production callers leave this unset
   * (effectively unbounded) so a report genuinely keeps retrying for
   * as long as the backend stays unreachable. */
  maxAttempts?: number;
}

const DEFAULT_INITIAL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** §9.12's own Done-when: "a status report sent during a network
 * outage arrives exactly once after reconnection." The "exactly once"
 * half is the server's own job (the Idempotency-Key header, generated
 * here as a deterministic `${jobId}:${status}` -- the same status for
 * the same job always reuses the same key, so however many times this
 * loop retries, the backend only ever actually applies the transition
 * once); this function's own job is just the "eventually arrives"
 * half -- retry with exponential backoff, capped at a ceiling, for as
 * long as it takes to reconnect. */
export async function reportJobStatusWithRetry(
  client: BackendClient,
  accessToken: string,
  jobId: string,
  status: ReportedJobStatus,
  osJobId: string | undefined,
  logger: pino.Logger,
  options: ReportStatusOptions = {},
): Promise<void> {
  const idempotencyKey = `${jobId}:${status}`;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? Infinity;
  let interval = options.initialIntervalMs ?? DEFAULT_INITIAL_INTERVAL_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.reportJobStatus(accessToken, jobId, idempotencyKey, status, osJobId);
      return;
    } catch (err) {
      if (attempt >= maxAttempts) {
        throw err;
      }
      logger.warn(
        { err, jobId, status, attempt, nextRetryMs: interval },
        "status report failed -- will retry",
      );
      await sleep(interval);
      interval = Math.min(interval * 2, maxIntervalMs);
    }
  }
}
