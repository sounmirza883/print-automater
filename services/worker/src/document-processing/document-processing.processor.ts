import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { QUEUE_NAMES, type DocumentProcessingJob } from "@print-automated/backend-shared";
import { DocumentProcessingService } from "./document-processing.service.js";

@Processor(QUEUE_NAMES.DOCUMENT_PROCESSING)
export class DocumentProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentProcessingProcessor.name);

  // Explicit @Inject(), not just the type annotation -- a class that
  // `extends WorkerHost` (from @nestjs/bullmq, a different package)
  // proved to have the same emitDecoratorMetadata unreliability as
  // DocumentProcessingService's own cross-package-injected params: the
  // constructor ran with `documentProcessing` undefined despite no
  // resolution error being thrown, only surfacing as "Cannot read
  // properties of undefined (reading 'process')" once a job actually
  // ran. Any future @Processor() class in this codebase should assume
  // it needs this too, not rely on type inference.
  constructor(
    @Inject(DocumentProcessingService)
    private readonly documentProcessing: DocumentProcessingService,
  ) {
    super();
  }

  async process(job: Job<DocumentProcessingJob>): Promise<{ documentId: string }> {
    this.logger.log(`Processing document ${job.data.documentId} (job ${job.id})`);
    await this.documentProcessing.process(job.data.documentId);
    return { documentId: job.data.documentId };
  }

  @OnWorkerEvent("completed")
  onCompleted(job: Job<DocumentProcessingJob>): void {
    this.logger.log(
      `Completed document-processing job ${job.id} for document ${job.data.documentId}`,
    );
  }

  /** §77's "failed-job logging" -- fires once a job exhausts every
   * retry attempt from DOCUMENT_PROCESSING_JOB_OPTIONS. A deliberate
   * REJECTED outcome never reaches here: DocumentProcessingService
   * catches DocumentRejectedError internally and returns normally, so
   * only a genuine infra failure (S3/DB/ClamAV unreachable) does. */
  @OnWorkerEvent("failed")
  onFailed(job: Job<DocumentProcessingJob> | undefined, error: Error): void {
    this.logger.error(
      `Document-processing job ${job?.id} for document ${job?.data.documentId} failed after ${job?.attemptsMade} attempt(s): ${error.message}`,
    );
  }
}
