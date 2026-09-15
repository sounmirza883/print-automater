import { Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES, type DocumentProcessingJob } from "@print-automated/backend-shared";

/** 2.6's Done-when only needs the worker to consume what 2.5's API
 * enqueues -- the real pipeline (fetch quarantine object, magic bytes,
 * size, ClamAV, page count, encrypt, move to documents/{id}, update the
 * row to READY or REJECTED) is 2.7's job. This deliberately does
 * nothing yet beyond proving the job was received and completing it. */
@Processor(QUEUE_NAMES.DOCUMENT_PROCESSING)
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  process(job: Job<DocumentProcessingJob>): Promise<{ documentId: string }> {
    this.logger.log(
      `Received document-processing job ${job.id} for document ${job.data.documentId}`,
    );
    return Promise.resolve({ documentId: job.data.documentId });
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<DocumentProcessingJob>): void {
    this.logger.log(
      `Completed document-processing job ${job.id} for document ${job.data.documentId}`,
    );
  }

  /** §77's "failed-job logging" -- fires once a job exhausts every
   * retry attempt from DOCUMENT_PROCESSING_JOB_OPTIONS, not on each
   * individual attempt. */
  @OnWorkerEvent("failed")
  onFailed(job: Job<DocumentProcessingJob> | undefined, error: Error): void {
    this.logger.error(
      `Document-processing job ${job?.id} for document ${job?.data.documentId} failed after ${job?.attemptsMade} attempt(s): ${error.message}`,
    );
  }
}
