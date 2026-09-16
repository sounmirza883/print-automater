import { randomUUID } from "node:crypto";
import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { DocumentStatus, PrintJobStatus, type Document } from "@prisma/client";
import type { CreateDocumentInput } from "@print-automated/validation";
import {
  AppException,
  PrismaService,
  StorageService,
  CryptoService,
  AuditService,
  KEY_MANAGEMENT_SERVICE,
  type KeyManagementService,
  QUEUE_NAMES,
  type DocumentProcessingJob,
  DocumentDeletionService,
} from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
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

export interface DecryptedDocument {
  buffer: Buffer;
  filename: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(KEY_MANAGEMENT_SERVICE) private readonly kms: KeyManagementService,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_PROCESSING)
    private readonly documentProcessingQueue: Queue<DocumentProcessingJob>,
    private readonly documentDeletion: DocumentDeletionService,
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

  /** §64/§65: authenticated, audited, decrypt-on-the-fly -- never a
   * presigned or otherwise permanent URL. Only the customer-owner path
   * is implemented here; §64 also names shop (documents on that shop's
   * active orders) and agent (documents on jobs assigned to its shop)
   * access, but neither orders (Phase 5) nor print jobs/agents (Phase
   * 8/9) exist yet to check against. Building a generic multi-accessor
   * check now, with two of three branches permanently unreachable until
   * those phases land, would just be dead code pretending to be more
   * finished than it is -- Phase 8/9 add their own access checks (to
   * this method or a shop/agent-specific variant) once there's a real
   * Order/PrintJob to authorize against. */
  async download(documentId: string, requestingUserId: string): Promise<DecryptedDocument> {
    const document = await this.getOwned(documentId, requestingUserId);
    const decrypted = await this.decrypt(document);

    await this.audit.record({
      actorId: requestingUserId,
      action: AuditAction.DOCUMENT_ACCESSED,
      resourceType: "document",
      resourceId: documentId,
    });

    return decrypted;
  }

  /** §64/9.8's own agent read path -- deferred at 2.8 for exactly the
   * reason its own comment gives: no PrintJob existed yet to authorize
   * against. Authorization here is "job assignment + job status," not
   * document ownership: an agent has no owner relationship to any
   * document at all, only a claim on the *job* that references one.
   * `CLAIMED` or `PRINTING` are the only legal states to fetch from --
   * QUEUED means this agent hasn't claimed it yet (9.7's claim is a
   * hard prerequisite, not optional), and every later state means the
   * print already finished or failed, where re-fetching the document
   * is either pointless or a signal something is wrong, not a normal
   * retry path. */
  async downloadForJob(jobId: string, deviceId: string): Promise<DecryptedDocument> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, printer: { agent: { deviceId } } },
      include: { order: { select: { documentId: true } } },
    });
    if (!job) {
      throw new NotFoundException("Print job not found.");
    }
    if (job.status !== PrintJobStatus.CLAIMED && job.status !== PrintJobStatus.PRINTING) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "JOB_NOT_CLAIMED",
        "This job must be claimed before its document can be fetched.",
        false,
      );
    }

    const document = await this.prisma.document.findUniqueOrThrow({
      where: { id: job.order.documentId },
    });
    const decrypted = await this.decrypt(document);

    await this.audit.record({
      actorId: null,
      action: AuditAction.DOCUMENT_ACCESSED,
      resourceType: "document",
      resourceId: document.id,
      metadata: { deviceId, jobId },
    });

    return decrypted;
  }

  private async decrypt(document: Document): Promise<DecryptedDocument> {
    if (
      document.status !== DocumentStatus.READY ||
      !document.storageKey ||
      !document.encryptedDek ||
      !document.iv ||
      !document.authTag
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "DOCUMENT_NOT_READY",
        "This document is not ready to download yet.",
        false,
      );
    }

    const ciphertext = await this.storage.getObjectBuffer(document.storageKey);
    const plaintextDek = await this.kms.unwrap(Buffer.from(document.encryptedDek));
    const buffer = await this.crypto.decryptBuffer(
      ciphertext,
      plaintextDek,
      Buffer.from(document.iv),
      Buffer.from(document.authTag),
    );

    return { buffer, filename: document.filename };
  }

  /** Soft delete: marks the row DELETED rather than removing it, so
   * order history (7.5) can still reference it after the document
   * itself is gone. 11.5's own DocumentDeletionService owns the actual
   * storage/encryption-metadata erasure (shared with its own retention
   * sweep) -- and, unlike this method's own original inline version,
   * genuinely propagates a real storage failure instead of swallowing
   * it, so a document is never marked DELETED while its ciphertext is
   * still sitting in the bucket. */
  async remove(documentId: string, ownerUserId: string): Promise<void> {
    await this.getOwned(documentId, ownerUserId);
    await this.documentDeletion.deleteDocumentStorage(documentId);
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
