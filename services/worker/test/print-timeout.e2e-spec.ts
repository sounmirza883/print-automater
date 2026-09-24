import "reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { AppException, OrderStateMachine, PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { PrintTimeoutProcessor } from "../src/print-timeout/print-timeout.processor.js";

/** §109/10.5's own Done-when: "shutting the agent down leaves the job
 * timed out and visible, never stuck in QUEUED forever." Same style as
 * 5.6's order-expiration.e2e-spec.ts and 9.4's
 * printer-offline-sweep.e2e-spec.ts -- drives the processor directly
 * through a Nest testing module rather than waiting on the real 30s
 * scheduler tick. */
describe("Print timeout sweep (10.5, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let processor: PrintTimeoutProcessor;
  let customerId: string;
  let shopId: string;
  let documentId: string;
  let printerId: string;
  const fakeJob = {} as Job;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    processor = app.get(PrintTimeoutProcessor);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Print Timeout E2E Customer",
        email: `print-timeout-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Print Timeout E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/print-timeout/${randomUUID()}`,
        filename: "print-timeout-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    const printer = await prisma.printer.create({
      data: { shopId, name: `Timeout Test Printer ${randomUUID()}`, status: PrinterStatus.ONLINE },
    });
    printerId = printer.id;
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    // FAIL_PRINT is one of §78/7.3's notification-producing events --
    // every timed-out order in this suite left a notification row
    // behind (same FK-ordering issue 10.4's own e2e fixture hit with
    // documents: delete what references the order before the order).
    await prisma.notification.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.printer.delete({ where: { id: printerId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  // 18.1/19.5: the sweep now queries `print_jobs.updated_at` (a job's
  // own age), not the order's -- an order can hold several jobs, only
  // some of which might be stuck, so "how long has THIS job sat here"
  // has to be the job row's own timestamp. `jobAgeMinutes` backdates
  // the print_job itself; the order is created fresh and, unless
  // `jobStatus` is omitted entirely, left for the sweep to derive.
  async function createOrder(
    status: OrderStatus,
    jobAgeMinutes: number,
    jobStatus?: PrintJobStatus,
  ): Promise<{ orderId: string; jobId: string | null }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-TIMEOUT-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: status,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    let jobId: string | null = null;
    if (jobStatus) {
      const job = await prisma.printJob.create({
        data: {
          orderId: order.id,
          printerId,
          shopId,
          status: jobStatus,
          idempotencyToken: randomUUID(),
        },
      });
      jobId = job.id;
      // Same test-only backdating as 5.6's own fixture -- print_jobs
      // only ever change via PrintJobStateMachine in real code, which
      // is what makes updated_at a reliable "how long in this status"
      // proxy to simulate without an actual wait.
      await prisma.$executeRaw`
        UPDATE print_jobs SET updated_at = NOW() - (${jobAgeMinutes} * INTERVAL '1 minute') WHERE id = ${job.id}
      `;
    }
    return { orderId: order.id, jobId };
  }

  it("§109: a QUEUED_FOR_PRINT order whose job is past the timeout fails to PRINT_FAILED and its job is marked TIMEOUT; a recent one and a different-status one are untouched", async () => {
    const stale = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.QUEUED);
    const fresh = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 1, PrintJobStatus.QUEUED);
    const differentStatus = await createOrder(OrderStatus.SHOP_ACCEPTED, 999);

    await processor.process(fakeJob);

    const [staleOrder, freshOrder, differentStatusOrder] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: stale.orderId } }),
      prisma.order.findUniqueOrThrow({ where: { id: fresh.orderId } }),
      prisma.order.findUniqueOrThrow({ where: { id: differentStatus.orderId } }),
    ]);
    expect(staleOrder.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    expect(freshOrder.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
    expect(differentStatusOrder.orderStatus).toBe(OrderStatus.SHOP_ACCEPTED);

    const staleJob = await prisma.printJob.findUniqueOrThrow({ where: { id: stale.jobId! } });
    expect(staleJob.status).toBe(PrintJobStatus.TIMEOUT);
  });

  it("§109: a job an agent claimed but never reported on also times out (not just an unclaimed one)", async () => {
    const claimed = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.CLAIMED);

    await processor.process(fakeJob);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: claimed.orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: claimed.jobId! } });
    expect(job.status).toBe(PrintJobStatus.TIMEOUT);
  });

  it("§109's own Done-when: a time-travelled job times out exactly once and is not double-processed on the next tick", async () => {
    const { orderId, jobId } = await createOrder(
      OrderStatus.QUEUED_FOR_PRINT,
      999,
      PrintJobStatus.QUEUED,
    );

    const first = await processor.process(fakeJob);
    expect(first.timedOutCount).toBeGreaterThanOrEqual(1);

    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterFirst.orderStatus).toBe(OrderStatus.PRINT_FAILED);

    const second = await processor.process(fakeJob);
    expect(second.timedOutCount).toBe(0);

    const timeoutAudits = await prisma.auditLog.count({
      where: { resourceType: "print_job", resourceId: jobId!, action: "PRINT_JOB_TIMEOUT" },
    });
    expect(timeoutAudits).toBe(1);
  });

  it("§109: two overlapping ticks racing the same stale job still time it out exactly once", async () => {
    const { orderId, jobId } = await createOrder(
      OrderStatus.QUEUED_FOR_PRINT,
      999,
      PrintJobStatus.QUEUED,
    );

    const [a, b] = await Promise.all([processor.process(fakeJob), processor.process(fakeJob)]);
    expect(a.timedOutCount + b.timedOutCount).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);

    const timeoutAudits = await prisma.auditLog.count({
      where: { resourceType: "print_job", resourceId: jobId!, action: "PRINT_JOB_TIMEOUT" },
    });
    expect(timeoutAudits).toBe(1);
  });

  /** 18.16: makes the ORDER side of the sync fail exactly once for one
   * order (SYNC_JOBS is the only event the sweep sends the order machine,
   * routed through the private applyLocked whichever public entry point
   * -- syncFromJobs or transitionWithin -- the implementation uses). */
  function failNextSyncFor(orderId: string, error: Error): jest.SpyInstance {
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

  it("18.16: a transient order-sync failure rolls the job write back (still QUEUED) and the NEXT tick times it out and fails the order", async () => {
    const { orderId, jobId } = await createOrder(
      OrderStatus.QUEUED_FOR_PRINT,
      999,
      PrintJobStatus.QUEUED,
    );
    const spy = failNextSyncFor(orderId, new Error("transient sync failure"));
    try {
      await expect(processor.process(fakeJob)).rejects.toThrow("transient sync failure");

      const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId! } });
      expect(job.status).toBe(PrintJobStatus.QUEUED);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
        OrderStatus.QUEUED_FOR_PRINT,
      );

      await processor.process(fakeJob);
      expect((await prisma.printJob.findUniqueOrThrow({ where: { id: jobId! } })).status).toBe(
        PrintJobStatus.TIMEOUT,
      );
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
        OrderStatus.PRINT_FAILED,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("18.16: a non-ILLEGAL_ORDER_TRANSITION AppException from the sync is not swallowed", async () => {
    const { orderId, jobId } = await createOrder(
      OrderStatus.QUEUED_FOR_PRINT,
      999,
      PrintJobStatus.QUEUED,
    );
    const spy = failNextSyncFor(
      orderId,
      new AppException(503, "SOMETHING_ELSE", "not an illegal transition", true),
    );
    try {
      await expect(processor.process(fakeJob)).rejects.toMatchObject({
        errorCode: "SOMETHING_ELSE",
      });
      expect((await prisma.printJob.findUniqueOrThrow({ where: { id: jobId! } })).status).toBe(
        PrintJobStatus.QUEUED,
      );
    } finally {
      spy.mockRestore();
    }
    await processor.process(fakeJob);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
      OrderStatus.PRINT_FAILED,
    );
  });
});
