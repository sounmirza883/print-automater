import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import request from "supertest";
import { DocumentStatus, UserRole } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import {
  PrismaService,
  StorageService,
  CryptoService,
  KEY_MANAGEMENT_SERVICE,
  type KeyManagementService,
  QUEUE_NAMES,
  type DocumentProcessingJob,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

describe("Documents (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let storage: StorageService;
  let queue: Queue<DocumentProcessingJob>;

  let owner: { id: string; role: UserRole };
  let stranger: { id: string; role: UserRole };
  let ownerToken: string;
  let strangerToken: string;
  let documentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    storage = app.get(StorageService);
    queue = app.get<Queue<DocumentProcessingJob>>(getQueueToken(QUEUE_NAMES.DOCUMENT_PROCESSING));

    owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Documents E2E Owner",
        email: `documents-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    stranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Documents E2E Stranger",
        email: `documents-e2e-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerToken = tokenService.issueAccessToken(owner);
    strangerToken = tokenService.issueAccessToken(stranger);
  });

  afterAll(async () => {
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (doc?.storageKey) {
        await storage.deleteObject(doc.storageKey).catch(() => undefined);
      }
    }
    await prisma.document.deleteMany({ where: { ownerUserId: { in: [owner.id, stranger.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  it("presigned PUT succeeds, confirming upload moves the document to PROCESSING, and another user's GET returns 403", async () => {
    // §86/12.2: sizeBytes declared at creation is signed into the
    // presigned URL as the exact required Content-Length (see
    // storage.service.ts's own comment) -- a real upload always
    // matches its own declared size, so this fixture's own PUT body
    // must too, or the PUT itself would be refused by MinIO before
    // ever reaching this test's actual assertions.
    const fakePdfBytes = Buffer.from("%PDF-1.7\nfake pdf content for documents.e2e-spec.ts\n%%EOF");

    // POST /documents
    const createRes = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        filename: "assignment.pdf",
        mimeType: "application/pdf",
        sizeBytes: fakePdfBytes.length,
      });
    expect(createRes.status).toBe(201);
    const { documentId: newDocumentId, uploadUrl } = createRes.body as {
      documentId: string;
      uploadUrl: string;
    };
    documentId = newDocumentId;
    expect(typeof documentId).toBe("string");
    expect(uploadUrl).toContain("quarantine");

    const pending = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(pending.status).toBe("PENDING_UPLOAD");

    // The presigned PUT succeeds -- a real, unauthenticated fetch()
    // against MinIO, not the AWS SDK.
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: fakePdfBytes,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(putResponse.ok).toBe(true);

    // Confirm -> the document reaches PROCESSING.
    const confirmRes = await request(app.getHttpServer())
      .post(`/v1/documents/${documentId}/upload`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("PROCESSING");

    const processing = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(processing.status).toBe("PROCESSING");

    // Upload completion enqueued the processing job (2.6/2.7 will
    // consume it; producer-side proof is that the job exists).
    const job = await queue.getJob(documentId);
    expect(job).toBeDefined();
    expect(job?.data.documentId).toBe(documentId);

    // Re-confirming is idempotent, not an error.
    const secondConfirmRes = await request(app.getHttpServer())
      .post(`/v1/documents/${documentId}/upload`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(secondConfirmRes.status).toBe(200);
    expect(secondConfirmRes.body.status).toBe("PROCESSING");

    // The owner can read it.
    const ownerGetRes = await request(app.getHttpServer())
      .get(`/v1/documents/${documentId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerGetRes.status).toBe(200);
    expect(ownerGetRes.body).toMatchObject({
      id: documentId,
      filename: "assignment.pdf",
      status: "PROCESSING",
      pageCount: null,
      rejectionReason: null,
    });

    // A different user's GET on the same id is 403, not 404 -- it
    // exists, it's just not theirs.
    const strangerGetRes = await request(app.getHttpServer())
      .get(`/v1/documents/${documentId}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerGetRes.status).toBe(403);
  });

  it("GET on a nonexistent id returns 404, distinct from the 403 for someone else's document", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${randomUUID()}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it("rejects a non-PDF mimeType before a presigned URL is ever generated", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ filename: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 1024 });
    expect(res.status).toBe(400);
  });

  it("§86/12.2: a filename with path-traversal segments is sanitized down to a bare, safe filename", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        filename: "../../../../etc/passwd.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      });
    expect(res.status).toBe(201);

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: res.body.documentId as string },
    });
    expect(doc.filename).toBe("passwd.pdf");
    expect(doc.filename).not.toContain("..");
    expect(doc.filename).not.toContain("/");
  });

  it("§86/12.2: an upload whose real byte count doesn't match the size declared at creation is refused by storage itself, before a single byte lands in the bucket -- this is what actually stops a class of attack like 'declare a small file, upload an arbitrarily large one' (the concrete '500MB upload' fixture is the same mechanism at a bigger scale)", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ filename: "small-declared.pdf", mimeType: "application/pdf", sizeBytes: 10 });
    expect(createRes.status).toBe(201);
    const { documentId: mismatchDocumentId, uploadUrl } = createRes.body as {
      documentId: string;
      uploadUrl: string;
    };

    // Genuinely larger than the 10 bytes declared at creation time --
    // MinIO/S3 refuse a presigned PUT whose real Content-Length doesn't
    // match what was signed, before a single byte is durably stored.
    const oversizedBody = Buffer.from("%PDF-1.7\n" + "A".repeat(200));
    const putResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: oversizedBody,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(putResponse.ok).toBe(false);

    // No residue: the refused PUT never created an object at the
    // would-be quarantine key at all.
    await expect(storage.objectExists(storage.quarantineKey(mismatchDocumentId))).resolves.toBe(
      false,
    );
  });
});

describe("Document download (2.8, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let storage: StorageService;
  let crypto: CryptoService;
  let kms: KeyManagementService;

  let owner: { id: string; role: UserRole };
  let stranger: { id: string; role: UserRole };
  let ownerToken: string;
  let strangerToken: string;
  let readyDocumentId: string;
  let pendingDocumentId: string;
  const plaintext = Buffer.from("%PDF-1.7\nreal decrypted content for the download test\n%%EOF");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    storage = app.get(StorageService);
    crypto = app.get(CryptoService);
    kms = app.get(KEY_MANAGEMENT_SERVICE);

    owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Download E2E Owner",
        email: `download-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    stranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Download E2E Stranger",
        email: `download-e2e-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerToken = tokenService.issueAccessToken(owner);
    strangerToken = tokenService.issueAccessToken(stranger);

    // Sets up a real READY document exactly as 2.7's worker would leave
    // it, without needing the worker running as part of this suite --
    // 2.7 already proves the pipeline itself; this proves the download
    // endpoint on its output.
    readyDocumentId = randomUUID();
    const { plaintextDek, wrappedDek } = await kms.generateDataKey();
    const encrypted = await crypto.encryptBuffer(plaintext, plaintextDek);
    const documentKey = storage.documentKey(readyDocumentId);
    await storage.putObjectBuffer(documentKey, encrypted.ciphertext, "application/octet-stream");
    await prisma.document.create({
      data: {
        id: readyDocumentId,
        ownerUserId: owner.id,
        storageKey: documentKey,
        filename: "ready-download.pdf",
        mimeType: "application/pdf",
        sizeBytes: plaintext.length,
        status: DocumentStatus.READY,
        pageCount: 1,
        checksum: "irrelevant-for-this-test",
        encryptedDek: new Uint8Array(wrappedDek),
        iv: new Uint8Array(encrypted.iv),
        authTag: new Uint8Array(encrypted.authTag),
        encryptionVersion: encrypted.encryptionVersion,
      },
    });

    pendingDocumentId = randomUUID();
    await prisma.document.create({
      data: {
        id: pendingDocumentId,
        ownerUserId: owner.id,
        storageKey: storage.quarantineKey(pendingDocumentId),
        filename: "still-processing.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        status: DocumentStatus.PROCESSING,
      },
    });
  });

  afterAll(async () => {
    await storage.deleteObject(storage.documentKey(readyDocumentId)).catch(() => undefined);
    await prisma.document.deleteMany({
      where: { id: { in: [readyDocumentId, pendingDocumentId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  it("the owner downloads the exact original decrypted bytes, and it's audited as DOCUMENT_ACCESSED", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${readyDocumentId}/download`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(res.body as Buffer).equals(plaintext)).toBe(true);

    const auditRows = await prisma.auditLog.findMany({
      where: { resourceType: "document", resourceId: readyDocumentId, action: "DOCUMENT_ACCESSED" },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actorId).toBe(owner.id);
  });

  it("§65: the download response is never a redirect to a presigned or otherwise permanent URL", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${readyDocumentId}/download`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200); // not a 3xx redirect to S3/MinIO
    expect(res.headers.location).toBeUndefined();
  });

  it("another user's download attempt returns 403, not the file", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${readyDocumentId}/download`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it("downloading a document that isn't READY yet is refused, not silently empty", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/documents/${pendingDocumentId}/download`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("DOCUMENT_NOT_READY");
  });
});
