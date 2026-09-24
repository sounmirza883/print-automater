import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** 18.27: API-level mirror of the print-timeout sweep's per-order-status
 * behaviour (the worker e2e cannot be run in this environment): the sweep
 * calls `PrintJobStateMachine.transition(id, TIMEOUT)` per stale job, so this
 * drives exactly that event against a stale QUEUED job under an order in each
 * status and pins what must happen. */
describe("Timeout of a stale job under each order status (18.27 mirror, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jobMachine: PrintJobStateMachine;
  let customerId: string;
  let counterId: string;
  let documentId: string;
  let shopId: string;
  let printerId: string;
  let agentId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    jobMachine = app.get(PrintJobStateMachine);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Atomic Sync Customer",
        email: `atomic-sync-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/atomic-sync/${randomUUID()}`,
        filename: "atomic-sync.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 2,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
    const shop = await prisma.shop.create({
      data: {
        name: `Atomic Sync Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopId = shop.id;
    const agent = await prisma.printerAgent.create({
      data: { deviceId: randomUUID(), shopId, publicKey: "irrelevant-test-public-key" },
    });
    agentId = agent.id;
    const printer = await prisma.printer.create({
      data: {
        shopId,
        agentId,
        name: "Atomic Sync Printer",
        status: PrinterStatus.ONLINE,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    printerId = printer.id;
    const counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Atomic Sync Counter",
        email: `atomic-sync-counter-${randomUUID()}@print-automated.dev`,
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
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: printerId } });
    await prisma.printerAgent.deleteMany({ where: { id: agentId } });
    await prisma.shopStaff.deleteMany({ where: { userId: counterId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerId, counterId] } } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await app.close();
  });

  async function seed(
    orderStatus: OrderStatus,
    jobStatus: PrintJobStatus,
  ): Promise<{ orderId: string; jobId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-TOSTATUS-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const job = await prisma.printJob.create({
      data: {
        orderId: order.id,
        shopId,
        printerId,
        idempotencyToken: randomUUID(),
        status: jobStatus,
      },
    });
    return { orderId: order.id, jobId: job.id };
  }

  const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const job = (id: string) => prisma.printJob.findUniqueOrThrow({ where: { id } });
  const orderAudits = (orderId: string, action: string) =>
    prisma.auditLog.count({ where: { resourceType: "order", resourceId: orderId, action } });

  const CASES: Array<[OrderStatus, OrderStatus, string]> = [
    [OrderStatus.QUEUED_FOR_PRINT, OrderStatus.PRINT_FAILED, "derived: fails the order"],
    [OrderStatus.PRINTING, OrderStatus.PRINT_FAILED, "derived: a stale QUEUED job fails the order"],
    [OrderStatus.PAUSED, OrderStatus.PRINT_FAILED, "derived: paused orders fail too"],
    [
      OrderStatus.SHOP_ACCEPTED,
      OrderStatus.SHOP_ACCEPTED,
      "not derived yet: job times out, order untouched",
    ],
    [OrderStatus.CANCELLED, OrderStatus.CANCELLED, "closed: job times out, order stays cancelled"],
  ];

  it.each(CASES)(
    "a stale QUEUED job under an order in %s -> order %s (%s); the job is TIMEOUT and the order sync ran exactly once or not at all",
    async (start, expected) => {
      const { orderId, jobId } = await seed(start, PrintJobStatus.QUEUED);
      await jobMachine.transition(
        jobId,
        PrintJobEvent.TIMEOUT,
        { id: null },
        { metadata: { reason: "timeout" } },
      );
      expect((await job(jobId)).status).toBe(PrintJobStatus.TIMEOUT);
      expect((await order(orderId)).orderStatus).toBe(expected);
      expect(
        await prisma.auditLog.count({
          where: { resourceType: "print_job", resourceId: jobId, action: "PRINT_JOB_TIMEOUT" },
        }),
      ).toBe(1);
      expect(await orderAudits(orderId, "ORDER_SYNC_JOBS")).toBe(expected === start ? 0 : 1);
    },
  );

  it("two overlapping timeouts of the same job: one wins, the other is ILLEGAL_JOB_TRANSITION, and the order is failed exactly once", async () => {
    const { orderId, jobId } = await seed(OrderStatus.QUEUED_FOR_PRINT, PrintJobStatus.QUEUED);
    const results = await Promise.allSettled(
      [0, 1].map(() => jobMachine.transition(jobId, PrintJobEvent.TIMEOUT, { id: null })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ errorCode: "ILLEGAL_JOB_TRANSITION" });
    expect((await order(orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
    expect(await orderAudits(orderId, "ORDER_SYNC_JOBS")).toBe(1);
  });
});
