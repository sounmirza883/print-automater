import { Inject, Logger } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { DocumentStatus, OrderStatus, UserRole, type Prisma } from "@prisma/client";
import {
  DocumentDeletionService,
  PrismaService,
  QUEUE_NAMES,
} from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";

/** Fix wave 1: how long an anonymous QR upload may sit with no order before it is
 * treated as abandoned and erased. A guest uploads and places the order within
 * minutes (the unpaid order itself only lives ORDER_PAYMENT_PENDING_TTL_MINUTES, 30
 * by default), so six hours never cuts off a real guest mid-order, while bounding
 * what anyone can store through the unauthenticated upload route with zero account
 * and zero follow-up. A constant, not an env var: the same "cadence/grace is not a
 * business setting" reasoning as the scheduler's own tick interval. */
export const ORPHANED_QR_DOCUMENT_GRACE_HOURS = 6;

/** Fix wave 1: orders that ended WITHOUT completing -- exactly the statuses
 * OrderStateMachine's TRANSITIONS table leaves with no exit (terminal) other than
 * COMPLETED itself. Every unclaimed QR order now ends EXPIRED rather than COMPLETED,
 * so without these its guest's document was kept forever. Deliberately NOT the
 * stuck-but-recoverable statuses (PRINT_FAILED, PRINT_STATUS_UNKNOWN, ...): staff can
 * still retry/resolve those, and they need the document to do it. */
export const CLOSED_WITHOUT_COMPLETION: OrderStatus[] = [
  OrderStatus.EXPIRED,
  OrderStatus.CANCELLED,
  OrderStatus.SHOP_REJECTED,
  OrderStatus.PAYMENT_FAILED,
];

/** §66/§67/11.5. One tick erases, through the shared DocumentDeletionService (the
 * same class 2.5's own customer-initiated delete already uses, so there is exactly
 * one place that knows how to actually erase a document's storage and encryption
 * metadata), every document in either of two classes:
 *
 * 1. ORDER-BASED (11.5, widened in fix wave 1): a READY document whose orders have
 *    ALL closed more than DOCUMENT_RETENTION_DAYS ago -- each one either COMPLETED
 *    (dated by completedAt, 11.5's original rule, unchanged) or closed without
 *    completing (CLOSED_WITHOUT_COMPLETION, dated by updatedAt: a terminal order's
 *    last write is the transition that closed it, and any later write only pushes
 *    deletion further out, the safe direction). "Every order" (Prisma's `every`),
 *    not "any order": a document can be referenced by more than one order, and this
 *    sweep must never delete one still needed by an order that is still live.
 *    `some: {}` is required alongside it -- `every` is vacuously true for a document
 *    with zero orders, which is class 2's business, not this one's.
 *
 * 2. ABANDONED QR UPLOADS (fix wave 1): a document owned by a shop's SYSTEM
 *    (QR-order) account that no order or order item references at all, created more
 *    than ORPHANED_QR_DOCUMENT_GRACE_HOURS ago, in ANY status that still holds
 *    storage -- including an upload PUT to its quarantine URL and never confirmed.
 *    Only SYSTEM-owned documents: an order-less upload by a real account belongs to
 *    that person, who can delete it themselves, and stays out of scope here. */
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
    const now = Date.now();
    const cutoff = new Date(now - this.env.DOCUMENT_RETENTION_DAYS * 24 * 60 * 60_000);
    const orphanCutoff = new Date(now - ORPHANED_QR_DOCUMENT_GRACE_HOURS * 60 * 60_000);

    const closedPastWindow: Prisma.OrderWhereInput = {
      OR: [
        { orderStatus: OrderStatus.COMPLETED, completedAt: { lt: cutoff } },
        { orderStatus: { in: CLOSED_WITHOUT_COMPLETION }, updatedAt: { lt: cutoff } },
      ],
    };

    const [orderBased, abandonedQrUploads] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          status: DocumentStatus.READY,
          orders: { some: {}, every: closedPastWindow },
        },
        select: { id: true },
      }),
      this.prisma.document.findMany({
        where: {
          storageKey: { not: null },
          owner: { role: UserRole.SYSTEM },
          orders: { none: {} },
          orderItems: { none: {} },
          createdAt: { lt: orphanCutoff },
        },
        select: { id: true },
      }),
    ]);

    // The two classes are disjoint (class 1 needs an order, class 2 needs none).
    const documents = [...orderBased, ...abandonedQrUploads];

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
      this.logger.log(
        `Document retention sweep: ${documents.length} document(s) deleted ` +
          `(${orderBased.length} past the order retention window, ` +
          `${abandonedQrUploads.length} abandoned QR upload(s)).`,
      );
    }
    return { deletedCount: documents.length, consideredCount: documents.length };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Document retention sweep (job ${job?.id}) failed: ${error.message}`);
  }
}
