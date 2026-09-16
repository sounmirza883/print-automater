import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { DocumentStatus, OrderStatus } from "@prisma/client";
import {
  DocumentDeletionService,
  PrismaService,
  QUEUE_NAMES,
} from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";

/** §66/§67/11.5. One tick: find every READY document whose order(s)
 * are all COMPLETED past the configured retention window, and erase
 * each one through the shared DocumentDeletionService -- the same
 * class 2.5's own customer-initiated delete already uses, so there is
 * exactly one place that knows how to actually erase a document's
 * storage and encryption metadata.
 *
 * "Every order" (Prisma's own `every` relation filter), not "any
 * order": a document technically *can* be referenced by more than one
 * order (Document.orders is a list relation), and this sweep must
 * never delete one still needed by an order that hasn't reached its
 * own COMPLETED-and-past-window state yet. `some: {}` is required
 * alongside it -- `every` is vacuously true for a document with zero
 * orders at all, which is not this sweep's business to delete (an
 * orphaned, never-ordered upload is a different lifecycle entirely,
 * outside 11.5's own scope). */
@Processor(QUEUE_NAMES.DOCUMENT_RETENTION)
export class DocumentRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentRetentionProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DocumentDeletionService) private readonly documentDeletion: DocumentDeletionService,
    @Inject(WORKER_ENV) private readonly env: WorkerEnv,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ deletedCount: number; consideredCount: number }> {
    const cutoff = new Date(Date.now() - this.env.DOCUMENT_RETENTION_DAYS * 24 * 60 * 60_000);
    const documents = await this.prisma.document.findMany({
      where: {
        status: DocumentStatus.READY,
        orders: {
          some: {},
          every: { orderStatus: OrderStatus.COMPLETED, completedAt: { lt: cutoff } },
        },
      },
      select: { id: true },
    });

    // No per-item try/catch: unlike 5.6/10.5's own sweeps, there is no
    // "someone else already handled it" race to swallow here (a
    // concurrent customer-initiated delete just leaves storageKey
    // already null, which deleteDocumentStorage() itself treats as a
    // no-op) -- a genuine failure (storage outage, bad credentials)
    // aborts the whole tick and surfaces via onFailed() below, and the
    // next scheduled tick retries the same still-eligible batch.
    for (const { id } of documents) {
      await this.documentDeletion.deleteDocumentStorage(id);
    }

    if (documents.length > 0) {
      this.logger.log(`Document retention sweep: ${documents.length} document(s) deleted.`);
    }
    return { deletedCount: documents.length, consideredCount: documents.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Document retention sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
