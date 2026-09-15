import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { DocumentStatus, type Document } from "@prisma/client";
import type { CreateDocumentInput } from "@print-automated/validation";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { QUEUE_NAMES } from "../queues/queue-names.js";
import type { DocumentProcessingJob } from "../queues/document-processing.job.js";
import { sanitizeFilename } from "./sanitize-filename.js";

export interface CreateDocumentResult {
  documentId: string;
  uploadUrl: string;
}

export interface DocumentStatusView {
  id: string;
  filename: string;
  status: DocumentStatus;
  pageCount: number | null;
  rejectionReason: string | null;
  createdAt: Date;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING)
    private readonly documentProcessingQueue: Queue<DocumentProcessingJob>,
  ) {}

  async create(ownerUserId: string, input: CreateDocumentInput): Promise<CreateDocumentResult> {
    // Generated here, not left to Prisma's @default(uuid()), so the
    // quarantine key can be derived and stored in the same single
    // insert -- no transient row with a placeholder/empty storageKey.
    const documentId = randomUUID();
    const storageKey = this.storage.quarantineKey(documentId);

    await this.prisma.document.create({
      data: {
        id: documentId,
        ownerUserId,
        storageKey,
        filename: sanitizeFilename(input.filename),
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: DocumentStatus.PENDING_UPLOAD,
      },
    });

    const uploadUrl = await this.storage.createPresignedPutUrl(storageKey, input.mimeType);
    return { documentId, uploadUrl };
  }

  /** Confirms the client finished PUTting directly to the presigned URL
   * (there is no server-side way to observe an anonymous presigned PUT
   * completing without real S3 event notifications, which this project
   * doesn't run). Idempotent: re-confirming an already-PROCESSING (or
   * later) document is a no-op that returns current state rather than
   * erroring, so a client retry after a dropped response is safe. */
  async confirmUpload(documentId: string, ownerUserId: string): Promise<DocumentStatusView> {
    const document = await this.getOwned(documentId, ownerUserId);

    if (document.status !== DocumentStatus.PENDING_UPLOAD) {
      return toStatusView(document);
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.PROCESSING },
    });

    await this.documentProcessingQueue.add(
      QUEUE_NAMES.DOCUMENT_PROCESSING,
      { documentId },
      { jobId: documentId }, // one job per document -- a duplicate confirm can't double-enqueue
    );

    return toStatusView(updated);
  }

  async getStatus(documentId: string, requestingUserId: string): Promise<DocumentStatusView> {
    const document = await this.getOwned(documentId, requestingUserId);
    return toStatusView(document);
  }

  /** Soft delete: removes the storage object (best-effort -- a document
   * still in PENDING_UPLOAD may have no object yet) and marks the row
   * DELETED rather than removing it, so order history (7.5) can still
   * reference it after the document itself is gone. */
  async remove(documentId: string, ownerUserId: string): Promise<void> {
    const document = await this.getOwned(documentId, ownerUserId);
    await this.storage.deleteObject(document.storageKey).catch(() => undefined);
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.DELETED },
    });
  }

  /** §64: "Customer: own documents/orders only." Distinguishes 404
   * (doesn't exist) from 403 (exists, but isn't yours) -- deliberately,
   * per this phase's own Done-when, not folded into a single 404 to
   * avoid confirming existence to strangers. */
  private async getOwned(documentId: string, requestingUserId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException("Document not found.");
    }
    if (document.ownerUserId !== requestingUserId) {
      throw new ForbiddenException("You do not have access to this document.");
    }
    return document;
  }
}

function toStatusView(document: Document): DocumentStatusView {
  return {
    id: document.id,
    filename: document.filename,
    status: document.status,
    pageCount: document.pageCount,
    rejectionReason: document.rejectionReason,
    createdAt: document.createdAt,
  };
}
