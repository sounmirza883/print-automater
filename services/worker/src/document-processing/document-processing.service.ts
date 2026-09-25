import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DocumentStatus, type Prisma } from "@prisma/client";
import {
  PrismaService,
  StorageService,
  CryptoService,
  KEY_MANAGEMENT_SERVICE,
  type KeyManagementService,
} from "@print-automated/backend-shared";
import { detectDocumentKind, type DocumentKind } from "./magic-bytes.js";
import { ClamavScannerService } from "./clamav-scanner.service.js";
import { PdfInspectorService } from "./pdf-inspector.service.js";
import { ImageToPdfService } from "./image-to-pdf.service.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import {
  RejectionReason,
  type RejectionReason as RejectionReasonType,
} from "./rejection-reason.js";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** §14/§86's full pipeline, in the exact order the design specifies:
 * magic bytes -> size -> ClamAV -> pdf-lib (page count, password) ->
 * checksum -> envelope-encrypt -> move to documents/{id} -> delete
 * quarantine -> READY. Any check failing rejects instead, with a
 * specific reason (§86), and still deletes the quarantine object --
 * that's the point of DocumentRejectedError being a distinct type from
 * every other thrown error (§46/§92-style safety: only a DELIBERATE
 * terminal outcome, accept or reject, deletes the quarantine object.
 * An unexpected infra failure -- S3/DB briefly down -- propagates
 * instead, leaving the quarantine object in place for BullMQ's retry
 * to find, rather than losing the customer's only uploaded copy). */
@Injectable()
export class DocumentProcessingService {
  // Every param has an explicit @Inject(), not just the interface-typed
  // one (kms) that strictly needs it -- emitDecoratorMetadata proved
  // unreliable here empirically (Nest reported PrismaService, at index
  // 0, as an undefined dependency despite PrismaModule being @Global()
  // and working fine for the identical injection in services/api).
  // Explicit tokens don't depend on design:paramtypes being captured
  // correctly at all, so they sidestep whatever specific metadata quirk
  // caused that rather than relying on a real understanding of it.
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(KEY_MANAGEMENT_SERVICE) private readonly kms: KeyManagementService,
    @Inject(ClamavScannerService) private readonly clamav: ClamavScannerService,
    @Inject(PdfInspectorService) private readonly pdfInspector: PdfInspectorService,
    @Inject(ImageToPdfService) private readonly imageToPdf: ImageToPdfService,
  ) {}

  async process(documentId: string): Promise<void> {
    const quarantineKey = this.storage.quarantineKey(documentId);
    const buffer = await this.storage.getObjectBuffer(quarantineKey);

    try {
      const kind = await this.validate(buffer);
      if (kind === "pdf") {
        const { pageCount } = await this.pdfInspector.inspect(buffer);
        await this.accept(documentId, buffer, pageCount);
      } else {
        // 21.9: JPG/PNG are normalised to a single-page PDF; the agent
        // and pricing only ever see that PDF, the upload is kept as the
        // original.
        const pdf = await this.imageToPdf.convert(buffer, kind);
        const { pageCount } = await this.pdfInspector.inspect(pdf);
        await this.accept(documentId, pdf, pageCount, {
          buffer,
          mimeType: kind === "jpeg" ? "image/jpeg" : "image/png",
        });
      }
    } catch (error) {
      if (!(error instanceof DocumentRejectedError)) {
        throw error;
      }
      await this.reject(documentId, error.reason);
    }

    // Reached only after a deliberate terminal outcome above (accept or
    // reject) -- never after a re-thrown unexpected error.
    await this.storage.deleteObject(quarantineKey);
  }

  /** Returns the kind sniffed from the real bytes (never the declared
   * mime type). */
  private async validate(buffer: Buffer): Promise<DocumentKind> {
    const kind = detectDocumentKind(buffer);
    if (!kind) {
      throw new DocumentRejectedError(RejectionReason.INVALID_FILE_TYPE);
    }
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new DocumentRejectedError(RejectionReason.FILE_TOO_LARGE);
    }
    await this.clamav.assertClean(buffer);
    return kind;
  }

  /** `buffer` is the printable PDF. `original` is set only when it was
   * derived from another upload (21.9 image, 21.10 DOCX): that upload is
   * kept encrypted under the SAME data key with its own fresh IV/tag, at
   * its own key, so deleting the document deletes both. */
  private async accept(
    documentId: string,
    buffer: Buffer,
    pageCount: number,
    original?: { buffer: Buffer; mimeType: string },
  ): Promise<void> {
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const { plaintextDek, wrappedDek } = await this.kms.generateDataKey();
    const encrypted = await this.crypto.encryptBuffer(buffer, plaintextDek);

    const documentKey = this.storage.documentKey(documentId);
    await this.storage.putObjectBuffer(
      documentKey,
      encrypted.ciphertext,
      "application/octet-stream",
    );

    let originalFields: Prisma.DocumentUpdateInput = {};
    if (original) {
      const encryptedOriginal = await this.crypto.encryptBuffer(original.buffer, plaintextDek);
      const originalKey = this.storage.originalDocumentKey(documentId);
      await this.storage.putObjectBuffer(
        originalKey,
        encryptedOriginal.ciphertext,
        "application/octet-stream",
      );
      originalFields = {
        mimeType: original.mimeType,
        originalStorageKey: originalKey,
        originalIv: new Uint8Array(encryptedOriginal.iv),
        originalAuthTag: new Uint8Array(encryptedOriginal.authTag),
      };
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        ...originalFields,
        status: DocumentStatus.READY,
        storageKey: documentKey,
        checksum,
        pageCount,
        // Buffer<ArrayBufferLike> isn't assignable to Prisma's Bytes
        // field type (Uint8Array<ArrayBuffer>) under strict lib types
        // (ArrayBufferLike also covers SharedArrayBuffer) -- these are
        // always real ArrayBuffer-backed in practice; new Uint8Array()
        // gives Prisma exactly the type it wants.
        encryptedDek: new Uint8Array(wrappedDek),
        iv: new Uint8Array(encrypted.iv),
        authTag: new Uint8Array(encrypted.authTag),
        encryptionVersion: encrypted.encryptionVersion,
      },
    });
  }

  private async reject(documentId: string, reason: RejectionReasonType): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.REJECTED, rejectionReason: reason },
    });
  }
}
