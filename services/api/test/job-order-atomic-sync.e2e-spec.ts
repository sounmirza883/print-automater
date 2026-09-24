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
  AppException,
  OrderStateMachine,
  PrintJobEvent,
  PrintJobStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** 18.16: a job write and the order sync it triggers are ONE transaction.
 * The order side is made to fail once (SYNC_JOBS through the private
 * applyLocked, which every public entry point funnels into); the job
 * write must roll back with it, and the retry must then succeed. */
describe("Job write and order sync are atomic (18.16, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jobMachine: PrintJobStateMachine;
  let customerId: string;
  let counterId: string;
  let documentId: string;
  let shopId: string;
  let counterToken: string;
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
        publicOrderNumber: `TEST-ATOMIC-${randomUUID()}`,
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

  /** Fails the order side of the NEXT SYNC_JOBS for `orderId`, once. */
  function failNextSync(orderId: string, error: Error): jest.SpyInstance {
    const original = (
      OrderStateMachine.prototype as unknown as {
        applyLocked: (...args: unknown[]) => Promise<unknown>;
      }
    ).applyLocked;
    let armed = true;
    return jest
      .spyOn(OrderStateMachine.prototype as never, "applyLocked" as never)
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        if (armed && args[1] === orderId && args[2] === "SYNC_JOBS") {
          armed = false;
          return Promise.reject(error);
        }
        return original.apply(this, args);
      } as never);
  }

  const order = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const job = (id: string) => prisma.printJob.findUniqueOrThrow({ where: { id } });

  it("a failed order sync rolls the job write back (still QUEUED, no audit row); the next attempt commits both", async () => {
    const { orderId, jobId } = await seed(OrderStatus.QUEUED_FOR_PRINT, PrintJobStatus.QUEUED);
    const spy = failNextSync(orderId, new Error("transient sync failure"));
    try {
      await expect(
        jobMachine.transition(jobId, PrintJobEvent.TIMEOUT, { id: null }),
      ).rejects.toThrow("transient sync failure");
      expect((await job(jobId)).status).toBe(PrintJobStatus.QUEUED);
      expect((await order(orderId)).orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
      expect(
        await prisma.auditLog.count({
          where: { resourceType: "print_job", resourceId: jobId, action: "PRINT_JOB_TIMEOUT" },
        }),
      ).toBe(0);

      await jobMachine.transition(jobId, PrintJobEvent.TIMEOUT, { id: null });
      expect((await job(jobId)).status).toBe(PrintJobStatus.TIMEOUT);
      expect((await order(orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
    } finally {
      spy.mockRestore();
    }
  });

  it("an agent-style FAILED report: sync failure leaves the CLAIMED job untouched, the same write then succeeds", async () => {
    const { orderId, jobId } = await seed(OrderStatus.QUEUED_FOR_PRINT, PrintJobStatus.CLAIMED);
    const spy = failNextSync(
      orderId,
      new AppException(503, "SOMETHING_ELSE", "not an illegal transition", true),
    );
    try {
      await expect(
        jobMachine.transition(jobId, PrintJobEvent.FAIL, { id: null }),
      ).rejects.toMatchObject({ errorCode: "SOMETHING_ELSE" });
      expect((await job(jobId)).status).toBe(PrintJobStatus.CLAIMED);
      await jobMachine.transition(jobId, PrintJobEvent.FAIL, { id: null });
      expect((await order(orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
    } finally {
      spy.mockRestore();
    }
  });

  it("an already-closed order (ILLEGAL_ORDER_TRANSITION) is tolerated: the job write still commits", async () => {
    const { orderId, jobId } = await seed(OrderStatus.CANCELLED, PrintJobStatus.QUEUED);
    await jobMachine.transition(jobId, PrintJobEvent.TIMEOUT, { id: null });
    expect((await job(jobId)).status).toBe(PrintJobStatus.TIMEOUT);
    expect((await order(orderId)).orderStatus).toBe(OrderStatus.CANCELLED);
  });

  it("CLAIM does not sync the order (single-job equivalence): the order stays QUEUED_FOR_PRINT", async () => {
    const { orderId, jobId } = await seed(OrderStatus.QUEUED_FOR_PRINT, PrintJobStatus.QUEUED);
    await jobMachine.transition(jobId, PrintJobEvent.CLAIM, { id: null }, { syncOrder: false });
    expect((await job(jobId)).status).toBe(PrintJobStatus.CLAIMED);
    expect((await order(orderId)).orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
  });

  it("retry-print: a failed sync rolls back the supersede AND the replacement job", async () => {
    const { orderId, jobId } = await seed(OrderStatus.PRINT_FAILED, PrintJobStatus.FAILED);
    const spy = failNextSync(orderId, new Error("transient sync failure"));
    try {
      const failed = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/retry-print`)
        .set("Authorization", `Bearer ${counterToken}`);
      expect(failed.status).toBeGreaterThanOrEqual(500);
      const afterFailure = await prisma.printJob.findMany({ where: { orderId } });
      expect(afterFailure).toHaveLength(1);
      expect(afterFailure[0]!.id).toBe(jobId);
      expect(afterFailure[0]!.supersededAt).toBeNull();
      expect((await order(orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);

      const ok = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/retry-print`)
        .set("Authorization", `Bearer ${counterToken}`);
      expect(ok.status).toBe(200);
      expect((await order(orderId)).orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
      const all = await prisma.printJob.findMany({ where: { orderId } });
      expect(all).toHaveLength(2);
      expect(all.filter((j) => j.supersededAt === null)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
