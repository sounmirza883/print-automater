import type pino from "pino";
import { queryPrintJobs } from "./print-queue.js";
import { PrintJobTracker, type MonitorOutcome } from "./print-job-tracker.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MonitorOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** §9.11. Call `queryPrintJobs(printerName, ...)` once *before*
 * `driver.print()` to capture `baselineJobIds`, submit the job, then
 * call this with that same baseline -- it polls every
 * `pollIntervalMs` (2s default, matching the plan's own number) until
 * `PrintJobTracker` reaches a verdict or `timeoutMs` elapses. */
export async function monitorPrintJob(
  printerName: string,
  baselineJobIds: ReadonlySet<number>,
  logger: pino.Logger,
  options: MonitorOptions = {},
): Promise<MonitorOutcome> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tracker = new PrintJobTracker(baselineJobIds);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await queryPrintJobs(printerName, logger);
    const outcome = tracker.feed(snapshot);
    if (outcome) {
      return outcome;
    }
    await sleep(pollIntervalMs);
  }

  return tracker.onTimeout();
}
