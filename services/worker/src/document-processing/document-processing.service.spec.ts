import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { DocumentStatus, UserRole } from "@prisma/client";
import { workerEnvSchema, loadEnv } from "@print-automated/config";
import {
  PrismaService,
  StorageService,
  CryptoService,
  LocalKmsProvider,
} from "@print-automated/backend-shared";
import { DocumentProcessingService } from "./document-processing.service.js";
import { ClamavScannerService } from "./clamav-scanner.service.js";
import { PdfInspectorService } from "./pdf-inspector.service.js";
import { RejectionReason } from "./rejection-reason.js";

// EICAR: the industry-standard antivirus test string. Every AV engine,
// including ClamAV, flags it as a "virus" -- it isn't one, it's
// specifically designed for exactly this kind of test.
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`;

const FIXTURES_DIR = path.resolve(__dirname, "../../test/fixtures");
const VALID_PDF = readFileSync(path.join(FIXTURES_DIR, "valid.pdf"));
const PASSWORD_PROTECTED_PDF = readFileSync(path.join(FIXTURES_DIR, "password-protected.pdf"));

/** ClamAV does file-type-aware scanning: for a recognized PDF header it
 * parses PDF structure and scans embedded streams/attachments, rather
 * than flat-scanning every byte -- confirmed empirically, a synthetic
 * "%PDF-\n" + raw EICAR text concatenation is NOT detected (ClamAV
 * can't find a real stream object to extract the signature from), even
 * though the identical bytes ARE detected with no PDF header at all.
 * A real PDF with the EICAR string as an actual embedded-file
 * attachment is what a real "malicious PDF" looks like, and is what
 * ClamAV's PDF-aware path actually scans. */
async function buildPdfWithEicarAttachment(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage();
  await pdfDoc.attach(Buffer.from(EICAR), "eicar.txt", {
    mimeType: "text/plain",
    description: "EICAR test file",
  });
  return Buffer.from(await pdfDoc.save());
}

describe("DocumentProcessingService (integration, real MinIO/Postgres/ClamAV)", () => {
  const env = loadEnv(workerEnvSchema, process.env);
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const storage = new StorageService(s3, env.S3_BUCKET);
  const crypto = new CryptoService();
  const kms = new LocalKmsProvider(env.KMS_LOCAL_MASTER_KEY!);
  const clamav = new ClamavScannerService(env);
  const pdfInspector = new PdfInspectorService();
  const prisma = new PrismaService();
  const service = new DocumentProcessingService(prisma, storage, crypto, kms, clamav, pdfInspector);

  let ownerId: string;
  const createdDocumentIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    const owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Document Processing Fixture Owner",
        email: `doc-processing-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerId = owner.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { id: { in: createdDocumentIds } } });
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
    s3.destroy();
  });

  /** Mirrors exactly what 2.5's DocumentsService.create + confirmUpload
   * leave behind before the worker ever sees the job: a PROCESSING row
   * and the raw bytes sitting at quarantine/{id}. */
  async function seedPendingDocument(buffer: Buffer): Promise<string> {
    const id = randomUUID();
    createdDocumentIds.push(id);
    const quarantineKey = storage.quarantineKey(id);

    await prisma.document.create({
      data: {
        id,
        ownerUserId: ownerId,
        storageKey: quarantineKey,
        filename: "fixture.pdf",
        mimeType: "application/pdf",
        sizeBytes: buffer.length,
        status: DocumentStatus.PROCESSING,
      },
    });
    await storage.putObjectBuffer(quarantineKey, buffer, "application/pdf");
    return id;
  }

  it("a valid PDF is accepted: status READY, correct page count/checksum, and decrypts back to the original bytes", async () => {
    const id = await seedPendingDocument(VALID_PDF);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.READY);
    expect(doc.pageCount).toBe(1);
    expect(doc.rejectionReason).toBeNull();
    expect(doc.storageKey).toBe(storage.documentKey(id));
    expect(doc.encryptedDek).not.toBeNull();
    expect(doc.iv).not.toBeNull();
    expect(doc.authTag).not.toBeNull();

    // The quarantine object is gone...
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
    // ...and the final encrypted object round-trips back to the
    // original plaintext bytes end to end.
    const plaintextDek = await kms.unwrap(Buffer.from(doc.encryptedDek!));
    const ciphertext = await storage.getObjectBuffer(doc.storageKey!);
    const decrypted = await crypto.decryptBuffer(
      ciphertext,
      plaintextDek,
      Buffer.from(doc.iv!),
      Buffer.from(doc.authTag!),
    );
    expect(decrypted.equals(VALID_PDF)).toBe(true);
  }, 30_000);

  it("a renamed .jpg (real JPEG bytes, no PDF magic bytes) is rejected on magic bytes", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const id = await seedPendingDocument(fakeJpeg);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.INVALID_FILE_TYPE);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 15_000);

  it("a 30MB file is rejected on size (valid magic bytes, so the size check specifically is exercised)", async () => {
    const oversized = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(30 * 1024 * 1024)]);
    const id = await seedPendingDocument(oversized);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.FILE_TOO_LARGE);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 30_000);

  it("an EICAR test file is rejected by ClamAV (valid magic bytes + size, so the AV check specifically is exercised)", async () => {
    const eicarPdf = await buildPdfWithEicarAttachment();
    const id = await seedPendingDocument(eicarPdf);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.MALWARE_DETECTED);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 30_000);

  it("a password-protected PDF is rejected", async () => {
    const id = await seedPendingDocument(PASSWORD_PROTECTED_PDF);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.PASSWORD_PROTECTED);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 15_000);

  // §86/12.2's own remaining adversarial fixtures -- EICAR and
  // password-protected are already covered above (2.7 built them
  // ahead of 12.2's own sub-phase); these three are the genuinely new
  // ones that land in THIS pipeline specifically (the size-vs-declared
  // mismatch and path-traversal-filename fixtures instead live at the
  // upload layer, services/api/test/documents.e2e-spec.ts, since
  // that's the layer that actually owns those two checks).

  it("§86/12.2: a renamed executable (real PE/MZ header, no PDF magic bytes) is rejected on magic bytes -- same check as the renamed-.jpg case above, exercised against a different, more consequential payload shape", async () => {
    // "MZ" (0x4D 0x5A) is the real DOS/PE executable magic-byte header
    // every Windows .exe starts with, followed by a plausible-looking
    // MS-DOS stub message -- not a full executable (nothing here is
    // ever run), just the header bytes the magic-bytes check itself
    // inspects.
    const fakeExe = Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      Buffer.from("This program cannot be run in DOS mode."),
    ]);
    const id = await seedPendingDocument(fakeExe);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.INVALID_FILE_TYPE);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 15_000);

  it("§86/12.2: a PDF bomb (501 legitimately-structured pages, past the 500-page cap) is rejected rather than accepted or hung on", async () => {
    // The safe, deterministic way to prove the page-count ceiling holds
    // against a resource-exhaustion-shaped PDF: build one honestly, via
    // pdf-lib itself (bounded, fast, no parser exploit involved), and
    // confirm the *server's own* limit -- not a parser crash or a hang
    // -- is what stops it. A hand-crafted malformed/recursive object
    // graph designed to exploit a hypothetical pdf-lib parsing bug is
    // deliberately out of scope here: it would risk hanging this very
    // test process without proving anything this codebase's own §86
    // limit doesn't already cover.
    const pdfDoc = await PDFDocument.create();
    for (let i = 0; i < 501; i += 1) {
      pdfDoc.addPage();
    }
    const bombBuffer = Buffer.from(await pdfDoc.save());
    const id = await seedPendingDocument(bombBuffer);

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.PAGE_LIMIT_EXCEEDED);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 30_000);

  it("§86/12.2: a zero-byte file is rejected on magic bytes, not a crash", async () => {
    const id = await seedPendingDocument(Buffer.alloc(0));

    await service.process(id);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe(DocumentStatus.REJECTED);
    expect(doc.rejectionReason).toBe(RejectionReason.INVALID_FILE_TYPE);
    await expect(storage.objectExists(storage.quarantineKey(id))).resolves.toBe(false);
  }, 15_000);
});
