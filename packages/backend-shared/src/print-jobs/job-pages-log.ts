import { Logger } from "@nestjs/common";
import type { JobPagesFallbackReason } from "./job-pages.js";

const logger = new Logger("jobPages");

/** 19.11: builds the `onFallback` callback callers pass to jobPages(), logging
 * each silent fallback at warn with a metric tag. */
export function logJobPagesFallback(
  ids: Record<string, string | undefined>,
): (reason: JobPagesFallbackReason) => void {
  return (reason) =>
    logger.warn(
      { metric: "job_pages.fallback", reason, ...ids },
      "Page count fell back to a default; allowance/accrual may be off for this job.",
    );
}
