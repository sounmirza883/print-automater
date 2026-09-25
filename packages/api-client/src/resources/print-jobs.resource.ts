import type { HttpClient } from "../http-client.js";
import type { JobFailureReason, ReprintReason } from "../types.js";

/** What every job action answers with (the job as the API sees it now). */
export interface PrintJobActionResult {
  id: string;
  orderId?: string;
  status: string;
  printerId?: string | null;
  blockedReason?: string | null;
}

export interface ReprintResult {
  reprintId: string;
  originalJobId: string;
  reason: string;
  additionalCostMinor: number;
  job: { id: string; orderId: string; status: string; printerName: string | null };
}

/** 21.x job-level actions. Each needs a permission at the job's business
 * (ASSIGN_JOBS, PAUSE_JOBS, RECORD_JOB_FAILURE, REPRINT_JOBS). */
export class PrintJobsResource {
  constructor(private readonly http: HttpClient) {}

  reassign(jobId: string, printerId: string, reason: string): Promise<PrintJobActionResult> {
    return this.http.request(`/v1/print-jobs/${jobId}/reassign`, {
      method: "POST",
      body: { printerId, reason },
    });
  }

  pause(jobId: string, reason?: string): Promise<PrintJobActionResult> {
    return this.http.request(`/v1/print-jobs/${jobId}/pause`, {
      method: "POST",
      body: reason === undefined ? {} : { reason },
    });
  }

  /** 409 LATE_PRINT_ACK_REQUIRED means the caller must resend with `acknowledgeLatePrint: true`. */
  resume(
    jobId: string,
    body: { printerId?: string; acknowledgeLatePrint?: boolean } = {},
  ): Promise<PrintJobActionResult> {
    return this.http.request(`/v1/print-jobs/${jobId}/resume`, { method: "POST", body });
  }

  recordFailureReason(
    jobId: string,
    reason: JobFailureReason,
    note?: string,
  ): Promise<PrintJobActionResult> {
    return this.http.request(`/v1/print-jobs/${jobId}/failure-reason`, {
      method: "POST",
      body: note === undefined ? { reason } : { reason, note },
    });
  }

  /** Replay-safe under `idempotencyKey`: reuse the SAME key when retrying one attempt. */
  reprint(
    jobId: string,
    input: {
      reason: ReprintReason;
      note?: string;
      additionalCostMinor?: number;
      printerId?: string;
    },
    idempotencyKey: string,
  ): Promise<ReprintResult> {
    return this.http.request(`/v1/print-jobs/${jobId}/reprint`, {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }
}
