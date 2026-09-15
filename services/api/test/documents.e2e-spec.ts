import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import request from "supertest";
import { UserRole } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import {
  PrismaService,
  StorageService,
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
      if (doc) {
        await storage.deleteObject(doc.storageKey).catch(() => undefined);
      }
    }
    await prisma.document.deleteMany({ where: { ownerUserId: { in: [owner.id, stranger.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  it("presigned PUT succeeds, confirming upload moves the document to PROCESSING, and another user's GET returns 403", async () => {
    // POST /documents
    const createRes = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ filename: "assignment.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
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
    const fakePdfBytes = Buffer.from("%PDF-1.7\nfake pdf content for documents.e2e-spec.ts\n%%EOF");
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
});
