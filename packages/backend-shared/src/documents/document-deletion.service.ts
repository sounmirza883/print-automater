import { Injectable } from "@nestjs/common";
import { DocumentStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

/** §66/§67/11.5. Shared by both services/api (2.5's own customer-
 * initiated `DELETE /documents/:id`) and services/worker (11.5's own
 * retention sweep) -- both need the exact same "actually erase this
 * document's storage and every trace of its encryption material"
 * operation, not two separately-maintained copies of it.
 *
 * Idempotent by construction, not by convention: `storageKey === null`
 * is checked first and short-circuits before touching storage or the
 * database at all, so re-running on an already-deleted document (11.5's
 * own Done-when) is a genuine no-op. S3's own `DeleteObjectCommand` is
 * additionally idempotent on the provider side (deleting an already-
 * absent key is not an error), so even a delete that reaches storage
 * more than once for the same key is still safe -- but a *storage
 * failure* (network, permissions, a genuinely wrong bucket) is
 * deliberately NOT swallowed here: it propagates, leaving `storageKey`
 * untouched for a future retry, rather than marking a document DELETED
 * while its ciphertext is still sitting in the bucket. That's a real
 * fix over 2.5's own original `DocumentsService.remove()`, which
 * caught and discarded every storage error unconditionally. */
@Injectable()
export class DocumentDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async deleteDocumentStorage(documentId: string): Promise<void> {
    const document = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (document.storageKey === null) {
      return;
    }

    await this.storage.deleteObject(document.storageKey);

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.DELETED,
        storageKey: null,
        encryptedDek: null,
        iv: null,
        authTag: null,
        encryptionVersion: null,
      },
    });
  }
}
