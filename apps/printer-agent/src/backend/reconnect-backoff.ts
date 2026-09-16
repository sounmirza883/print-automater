export interface ReconnectBackoffOptions {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
}

const DEFAULT_INITIAL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_INTERVAL_MS = 60_000;

/** §90/10.7: "Agent reconnects with exponential backoff and bounded
 * ceiling, then reconciles state before resuming." Deliberately
 * separate from 9.12's own `reportJobStatusWithRetry`
 * (status-reporter.ts) -- that function already has its own tested,
 * working backoff shape scoped to a single report call; this is new,
 * since index.ts's heartbeat and job-poll loops (which run for the
 * agent's entire lifetime, not once per report) had no backoff at all
 * before 10.7. A pure calculator, kept separate from the loops
 * themselves and from any actual sleep()/setTimeout call, for the same
 * hermetic-testing reason PrintJobTracker/classifyPrintFailure/
 * buildPrintSettings are each split from their own I/O wrapper. */
export class ReconnectBackoff {
  private readonly initialIntervalMs: number;
  private readonly maxIntervalMs: number;
  private interval: number;
  private consecutiveFailures = 0;

  constructor(options: ReconnectBackoffOptions = {}) {
    this.initialIntervalMs = options.initialIntervalMs ?? DEFAULT_INITIAL_INTERVAL_MS;
    this.maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
    this.interval = this.initialIntervalMs;
  }

  /** Call after a failed attempt. Returns how long the caller should
   * wait before the next one -- doubling every call, capped at
   * maxIntervalMs, so a persistent outage backs off instead of
   * hammering the backend at a fixed short interval forever. */
  recordFailure(): number {
    this.consecutiveFailures += 1;
    const delay = this.interval;
    this.interval = Math.min(this.interval * 2, this.maxIntervalMs);
    return delay;
  }

  /** Call after a successful attempt. Resets the backoff for the next
   * outage, and returns true exactly when this success follows one or
   * more failures -- i.e. "we were down and just reconnected." That
   * signal is what index.ts uses to trigger reconciliation (re-sweeping
   * the ledger) exactly once per outage, not on every healthy tick. */
  recordSuccess(): boolean {
    const justReconnected = this.consecutiveFailures > 0;
    this.consecutiveFailures = 0;
    this.interval = this.initialIntervalMs;
    return justReconnected;
  }
}
