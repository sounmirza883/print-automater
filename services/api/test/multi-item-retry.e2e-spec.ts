import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { branchIdOf } from "./helpers/branches.js";

/** 18.17: retry / change-printer / resolve-unknown(RETRY) act ONLY on the
 * items whose current job is FAILED/TIMEOUT (UNKNOWN for resolve-unknown).
 * A 3-item order where item 1 PRINTED, item 2 FAILED, item 3 PRINTING must
 * not reprint item 1 (the cardinal sin: duplicate printing) nor orphan
 * item 3's in-flight job. */
describe("Multi-item retry only touches the failed items (18.17, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customerId: string;
  let counterId: string;
  let documentId: string;
  let shopId: string;
  let counterToken: string;
  let printerA: { id: string };
  let printerB: { id: string };
  const orderIds: string[] = [];
  const printerIds: string[] = [];
  const agentIds: string[] = [];

  const config = {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  };

  async function makePrinter(name: string): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        publicKey: "irrelevant-test-public-key",
      },
    });
    agentIds.push(agent.id);
    const printer = await prisma.printer.create({
      data: {
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        agentId: agent.id,
        name,
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Multi Item Retry Customer",
        email: `multi-item-retry-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/multi-item-retry/${randomUUID()}`,
        filename: "multi-item-retry.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 3,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
    const shop = await prisma.shop.create({
      data: {
        name: `Multi Item Retry Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        multiItemEnabled: true,
      },
    });
    shopId = shop.id;
    printerA = await makePrinter("Retry Printer A");
    printerB = await makePrinter("Retry Printer B");

    const counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Multi Item Retry Counter",
        email: `multi-item-retry-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    counterId = counter.id;
    await prisma.shopStaff.create({
      data: {
        shopId,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = app.get(TokenService).issueAccessToken(counter);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: counterId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerId, counterId] } } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await app.close();
  });

  async function seed(
    orderStatus: OrderStatus,
    statuses: [PrintJobStatus, PrintJobStatus, PrintJobStatus],
  ): Promise<{ orderId: string; itemIds: string[]; jobIds: string[] }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-MIRETRY-${randomUUID()}`,
        customerId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: config,
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const itemIds: string[] = [];
    const jobIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId,
          printConfiguration: config,
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: i,
        },
      });
      itemIds.push(item.id);
      const job = await prisma.printJob.create({
        data: {
          orderId: order.id,
          shopId,
          branchId: await branchIdOf(prisma, shopId),
          orderItemId: item.id,
          printerId: printerA.id,
          idempotencyToken: `${item.id}:1`,
          status: statuses[i]!,
        },
      });
      jobIds.push(job.id);
    }
    return { orderId: order.id, itemIds, jobIds };
  }

  async function expectUntouched(jobId: string, status: PrintJobStatus): Promise<void> {
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(status);
    expect(job.supersededAt).toBeNull();
    expect(job.printerId).toBe(printerA.id);
    expect(job.attempt).toBe(1);
  }

  async function assertOnlyFailedItemReplaced(
    orderId: string,
    itemIds: string[],
    jobIds: string[],
    replacementPrinterId?: string,
  ): Promise<void> {
    await expectUntouched(jobIds[0]!, PrintJobStatus.PRINTED);
    await expectUntouched(jobIds[2]!, PrintJobStatus.PRINTING);

    const all = await prisma.printJob.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(all.filter((j) => j.supersededAt === null)).toHaveLength(3);
    // Exactly ONE job was created by the action, and it is for item 2.
    const created = all.filter((j) => !jobIds.includes(j.id));
    expect(created).toHaveLength(1);
    expect(created[0]!.orderItemId).toBe(itemIds[1]);
    expect(created[0]!.status).toBe(PrintJobStatus.QUEUED);
    expect(created[0]!.attempt).toBe(2);
    if (replacementPrinterId) {
      expect(created[0]!.printerId).toBe(replacementPrinterId);
    }
    // The failed original is superseded, never deleted.
    expect(all.find((j) => j.id === jobIds[1])!.supersededAt).not.toBeNull();
    // No second job for items 1 or 3 anywhere, on any printer.
    for (const idx of [0, 2]) {
      expect(all.filter((j) => j.orderItemId === itemIds[idx])).toHaveLength(1);
    }
  }

  it("retry-print: PRINTED + FAILED + PRINTING -> exactly one new job, for the FAILED item only", async () => {
    const { orderId, itemIds, jobIds } = await seed(OrderStatus.PRINT_FAILED, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.FAILED,
      PrintJobStatus.PRINTING,
    ]);
    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/retry-print`)
      .set("Authorization", `Bearer ${counterToken}`);
    expect(res.status).toBe(200);
    await assertOnlyFailedItemReplaced(orderId, itemIds, jobIds);
    // Item 3 is still PRINTING, so the order is PRINTING, not a fresh queue.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
      OrderStatus.PRINTING,
    );
  });

  it("change-printer: same rule, and the replacement goes to the named printer", async () => {
    const { orderId, itemIds, jobIds } = await seed(OrderStatus.PRINT_FAILED, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.TIMEOUT,
      PrintJobStatus.PRINTING,
    ]);
    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/change-printer`)
      .set("Authorization", `Bearer ${counterToken}`)
      .send({ printerId: printerB.id });
    expect(res.status).toBe(200);
    await assertOnlyFailedItemReplaced(orderId, itemIds, jobIds, printerB.id);
  });

  it("resolve-unknown RETRY: only the UNKNOWN item is superseded and re-dispatched", async () => {
    const { orderId, itemIds, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
      PrintJobStatus.PRINTING,
    ]);
    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${counterToken}`)
      .send({ resolution: "RETRY" });
    expect(res.status).toBe(200);
    await assertOnlyFailedItemReplaced(orderId, itemIds, jobIds);
  });

  it("retry with no FAILED/TIMEOUT job anywhere is refused (409) and reprints nothing", async () => {
    const { orderId, jobIds } = await seed(OrderStatus.PRINT_FAILED, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.PRINTED,
      PrintJobStatus.PRINTED,
    ]);
    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/retry-print`)
      .set("Authorization", `Bearer ${counterToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("NO_RETRYABLE_ITEMS");
    const jobs = await prisma.printJob.findMany({ where: { orderId } });
    expect(jobs.map((j) => j.id).sort()).toEqual([...jobIds].sort());
    expect(jobs.every((j) => j.supersededAt === null && j.status === PrintJobStatus.PRINTED)).toBe(
      true,
    );
  });

  it("a double-tapped retry (concurrent) does not create a second replacement", async () => {
    const { orderId, itemIds, jobIds } = await seed(OrderStatus.PRINT_FAILED, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.FAILED,
      PrintJobStatus.PRINTING,
    ]);
    const responses = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/v1/shop/orders/${orderId}/retry-print`)
          .set("Authorization", `Bearer ${counterToken}`),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await assertOnlyFailedItemReplaced(orderId, itemIds, jobIds);
  });
});
