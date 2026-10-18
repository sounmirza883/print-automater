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
import {
  DocumentRetentionProcessor,
  ORPHANED_QR_DOCUMENT_GRACE_HOURS,
} from "../src/document-retention/document-retention.processor.js";
import { branchIdOf } from "./helpers/branches.js";

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
  /** A shop's synthetic QR-order account (24.1): owns every QR guest's upload. */
  let systemUserId: string;
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

    const systemUser = await prisma.user.create({
      data: {
        role: UserRole.SYSTEM,
        name: "Document Retention E2E QR System",
        email: `qr-orders+${randomUUID()}@system.print-automated.invalid`,
        passwordHash: "irrelevant",
      },
    });
    systemUserId = systemUser.id;
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    if (sharedShopId) {
      await prisma.shop.delete({ where: { id: sharedShopId.id } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [customerId, systemUserId] } } });
    await app.close();
  }, 20_000);

  async function createReadyDocument(
    options: { ownerUserId?: string; createdAgoHours?: number } = {},
  ): Promise<{ documentId: string; storageKey: string }> {
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
        ownerUserId: options.ownerUserId ?? customerId,
        storageKey,
        filename: "retention-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
        encryptedDek: Buffer.from("dummy-dek"),
        iv: Buffer.from("dummy-iv"),
        authTag: Buffer.from("dummy-tag"),
        encryptionVersion: 1,
        ...(options.createdAgoHours === undefined
          ? {}
          : { createdAt: new Date(Date.now() - options.createdAgoHours * 3_600_000) }),
      },
    });
    documentIds.push(documentId);
    return { documentId, storageKey };
  }

  /** A public (QR) upload that was created and PUT to its presigned quarantine URL but
   * never confirmed -- the storage-abuse shape: bytes stored, no order ever follows. */
  async function createUnconfirmedQrUpload(
    createdAgoHours: number,
  ): Promise<{ documentId: string; storageKey: string }> {
    const documentId = randomUUID();
    const storageKey = storage.quarantineKey(documentId);
    await storage.putObjectBuffer(storageKey, Buffer.from("raw guest bytes"), "application/pdf");
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: systemUserId,
        storageKey,
        filename: "never-ordered.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.PENDING_UPLOAD,
        createdAt: new Date(Date.now() - createdAgoHours * 3_600_000),
      },
    });
    documentIds.push(documentId);
    return { documentId, storageKey };
  }

  async function expectDeleted(documentId: string, storageKey: string): Promise<void> {
    await expect(storage.objectExists(storageKey)).resolves.toBe(false);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.DELETED);
    expect(doc.storageKey).toBeNull();
    expect(doc.encryptedDek).toBeNull();
  }

  async function expectKept(documentId: string, storageKey: string): Promise<void> {
    await expect(storage.objectExists(storageKey)).resolves.toBe(true);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).not.toBe(DocumentStatus.DELETED);
    expect(doc.storageKey).toBe(storageKey);
  }

  async function createOrder(
    documentId: string,
    orderStatus: OrderStatus,
    completedAgoDays: number | null,
    options: { updatedAgoDays?: number; customerId?: string } = {},
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-RETENTION-${randomUUID()}`,
        customerId: options.customerId ?? customerId,
        shopId: (await ensureShop()).id,
        branchId: await branchIdOf(prisma, (await ensureShop()).id),
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus,
        completedAt:
          completedAgoDays === null ? null : new Date(Date.now() - completedAgoDays * 86_400_000),
      },
    });
    orderIds.push(order.id);
    if (options.updatedAgoDays !== undefined) {
      // updated_at is the order's last write -- for a terminal order, when it closed.
      // Raw SQL: Prisma's @updatedAt would stamp "now" over a value passed through it.
      const updatedAt = new Date(Date.now() - options.updatedAgoDays * 86_400_000);
      await prisma.$executeRaw`UPDATE orders SET updated_at = ${updatedAt} WHERE id = ${order.id}`;
    }
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

  describe("fix wave 1: orders that closed WITHOUT completing (EXPIRED, CANCELLED, SHOP_REJECTED, PAYMENT_FAILED)", () => {
    it.each([
      OrderStatus.EXPIRED,
      OrderStatus.CANCELLED,
      OrderStatus.SHOP_REJECTED,
      OrderStatus.PAYMENT_FAILED,
    ])("a document whose only order is %s past the retention window is deleted", async (status) => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, status, null, { updatedAgoDays: 999 });

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
    });

    it("an unclaimed QR order that EXPIRED past the window loses its guest's document (the order record stays)", async () => {
      const { documentId, storageKey } = await createReadyDocument({ ownerUserId: systemUserId });
      const orderId = await createOrder(documentId, OrderStatus.EXPIRED, null, {
        updatedAgoDays: 999,
        customerId: systemUserId,
      });

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
      await expect(prisma.order.findUnique({ where: { id: orderId } })).resolves.not.toBeNull();
    });

    it("one that closed inside the retention window is kept", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, OrderStatus.EXPIRED, null, { updatedAgoDays: 1 });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("a document shared by a COMPLETED and an EXPIRED order, both past the window, is deleted", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, OrderStatus.COMPLETED, 999);
      await createOrder(documentId, OrderStatus.EXPIRED, null, { updatedAgoDays: 999 });

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
    });

    it("but never while any order on it is still live, however old the closed one is", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, OrderStatus.CANCELLED, null, { updatedAgoDays: 999 });
      await createOrder(documentId, OrderStatus.WAITING_FOR_SHOP, null, { updatedAgoDays: 999 });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("a stuck but non-terminal order (PRINT_FAILED) is never treated as closed, however old", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, OrderStatus.PRINT_FAILED, null, { updatedAgoDays: 999 });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("re-review fix: a closed order's own document, ALSO referenced as an order-item on a separate still-live order, is kept", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      // Its own order is closed and well past the window...
      await createOrder(documentId, OrderStatus.EXPIRED, null, { updatedAgoDays: 999 });
      // ...but it is also an item on a completely different order that is still live.
      const liveOrderId = await createOrder(
        (await createReadyDocument()).documentId,
        OrderStatus.WAITING_FOR_SHOP,
        null,
      );
      await prisma.orderItem.create({
        data: {
          orderId: liveOrderId,
          documentId,
          printConfiguration: {},
          quantity: 1,
          itemType: "PRINT",
          sequence: 2,
        },
      });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("control: the same shape, but the order-item's order is ALSO closed past the window -- still deleted", async () => {
      const { documentId, storageKey } = await createReadyDocument();
      await createOrder(documentId, OrderStatus.EXPIRED, null, { updatedAgoDays: 999 });
      const otherOrderId = await createOrder(
        (await createReadyDocument()).documentId,
        OrderStatus.CANCELLED,
        null,
        { updatedAgoDays: 999 },
      );
      await prisma.orderItem.create({
        data: {
          orderId: otherOrderId,
          documentId,
          printConfiguration: {},
          quantity: 1,
          itemType: "PRINT",
          sequence: 2,
        },
      });

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
    });
  });

  describe(`fix wave 1: anonymous QR uploads no order ever used (grace ${ORPHANED_QR_DOCUMENT_GRACE_HOURS}h)`, () => {
    it("a processed QR upload with no order, older than the grace period, is deleted", async () => {
      const { documentId, storageKey } = await createReadyDocument({
        ownerUserId: systemUserId,
        createdAgoHours: ORPHANED_QR_DOCUMENT_GRACE_HOURS + 1,
      });

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
    });

    it("an upload that was PUT but never even confirmed has its quarantine object deleted too", async () => {
      const { documentId, storageKey } = await createUnconfirmedQrUpload(
        ORPHANED_QR_DOCUMENT_GRACE_HOURS + 1,
      );

      await processor.process(fakeJob);

      await expectDeleted(documentId, storageKey);
    });

    it("one still inside the grace period (a guest mid-order) is kept", async () => {
      const { documentId, storageKey } = await createReadyDocument({
        ownerUserId: systemUserId,
        createdAgoHours: ORPHANED_QR_DOCUMENT_GRACE_HOURS - 1,
      });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("an old QR upload that DID become an order is left to the order-based rules", async () => {
      const { documentId, storageKey } = await createReadyDocument({
        ownerUserId: systemUserId,
        createdAgoHours: ORPHANED_QR_DOCUMENT_GRACE_HOURS + 1,
      });
      await createOrder(documentId, OrderStatus.UPLOADED, null, { customerId: systemUserId });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("an old QR upload used only as another order's item document is not an orphan", async () => {
      const { documentId, storageKey } = await createReadyDocument({
        ownerUserId: systemUserId,
        createdAgoHours: ORPHANED_QR_DOCUMENT_GRACE_HOURS + 1,
      });
      const main = await createReadyDocument({ ownerUserId: systemUserId });
      const orderId = await createOrder(main.documentId, OrderStatus.WAITING_FOR_SHOP, null, {
        customerId: systemUserId,
      });
      await prisma.orderItem.create({
        data: {
          orderId,
          documentId,
          printConfiguration: {},
          quantity: 1,
          itemType: "PRINT",
          sequence: 2,
        },
      });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });

    it("an old order-less upload owned by a real account is out of this sweep's scope (kept)", async () => {
      const { documentId, storageKey } = await createReadyDocument({
        createdAgoHours: ORPHANED_QR_DOCUMENT_GRACE_HOURS * 100,
      });

      await processor.process(fakeJob);

      await expectKept(documentId, storageKey);
    });
  });
});
