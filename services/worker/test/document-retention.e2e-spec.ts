import "reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import { DocumentStatus, OrderStatus, UserRole } from "@prisma/client";
import {
  DocumentDeletionService,
  PrismaService,
  StorageService,
} from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { DocumentRetentionProcessor } from "../src/document-retention/document-retention.processor.js";

/** §66/§67/11.5, e2e: "a completed order past its window has its
 * document securely deleted while the order record remains fully
 * viewable." Drives the processor directly against real Postgres and
 * real MinIO storage -- same style 5.6/9.4/10.5's own sweep tests use,
 * plus real storage.objectExists() checks the way
 * document-processing.service.spec.ts's own tests already do. */
describe("Document retention sweep (11.5, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let storage: StorageService;
  let documentDeletion: DocumentDeletionService;
  let processor: DocumentRetentionProcessor;
  let customerId: string;
  const fakeJob = {} as Job;
  const documentIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    documentDeletion = app.get(DocumentDeletionService);
    processor = app.get(DocumentRetentionProcessor);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Document Retention E2E Customer",
        email: `doc-retention-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    if (sharedShopId) {
      await prisma.shop.delete({ where: { id: sharedShopId.id } });
    }
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  }, 20_000);

  async function createReadyDocument(): Promise<{ documentId: string; storageKey: string }> {
    const documentId = randomUUID();
    const storageKey = storage.documentKey(documentId);
    await storage.putObjectBuffer(
      storageKey,
      Buffer.from("fake encrypted pdf bytes"),
      "application/octet-stream",
    );
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: customerId,
        storageKey,
        filename: "retention-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
        encryptedDek: Buffer.from("dummy-dek"),
        iv: Buffer.from("dummy-iv"),
        authTag: Buffer.from("dummy-tag"),
        encryptionVersion: 1,
      },
    });
    documentIds.push(documentId);
    return { documentId, storageKey };
  }

  async function createOrder(
    documentId: string,
    orderStatus: OrderStatus,
    completedAgoDays: number | null,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-RETENTION-${randomUUID()}`,
        customerId,
        shopId: (await ensureShop()).id,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus,
        completedAt:
          completedAgoDays === null ? null : new Date(Date.now() - completedAgoDays * 86_400_000),
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  let sharedShopId: { id: string } | null = null;
  async function ensureShop(): Promise<{ id: string }> {
    if (sharedShopId) {
      return sharedShopId;
    }
    const shop = await prisma.shop.create({
      data: { name: `Document Retention E2E Shop ${randomUUID()}`, address: "1" },
    });
    sharedShopId = shop;
    return shop;
  }

  it("11.5's own Done-when: a completed order past its window has its document securely deleted", async () => {
    const { documentId, storageKey } = await createReadyDocument();
    await createOrder(documentId, OrderStatus.COMPLETED, 999);

    const result = await processor.process(fakeJob);
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    await expect(storage.objectExists(storageKey)).resolves.toBe(false);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.DELETED);
    expect(doc.storageKey).toBeNull();
    expect(doc.encryptedDek).toBeNull();
    expect(doc.iv).toBeNull();
    expect(doc.authTag).toBeNull();
    expect(doc.encryptionVersion).toBeNull();
  });

  it("a completed order still inside the retention window is not touched", async () => {
    const { documentId, storageKey } = await createReadyDocument();
    await createOrder(documentId, OrderStatus.COMPLETED, 1);

    await processor.process(fakeJob);

    await expect(storage.objectExists(storageKey)).resolves.toBe(true);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.READY);
  });

  it("an order that has not reached COMPLETED yet is never eligible, no matter how old", async () => {
    const { documentId, storageKey } = await createReadyDocument();
    await createOrder(documentId, OrderStatus.PRINTING, null);

    await processor.process(fakeJob);

    await expect(storage.objectExists(storageKey)).resolves.toBe(true);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.READY);
  });

  it("a document referenced by two orders is kept until EVERY order is completed past the window", async () => {
    const { documentId, storageKey } = await createReadyDocument();
    await createOrder(documentId, OrderStatus.COMPLETED, 999);
    await createOrder(documentId, OrderStatus.WAITING_FOR_SHOP, null);

    await processor.process(fakeJob);

    await expect(storage.objectExists(storageKey)).resolves.toBe(true);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.READY);
  });

  it("§66/§67's own idempotency: re-running deletion on an already-deleted document is a no-op, not an error", async () => {
    const { documentId, storageKey } = await createReadyDocument();
    await createOrder(documentId, OrderStatus.COMPLETED, 999);

    await processor.process(fakeJob);
    await expect(storage.objectExists(storageKey)).resolves.toBe(false);

    await expect(documentDeletion.deleteDocumentStorage(documentId)).resolves.toBeUndefined();
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.DELETED);
  });
});
