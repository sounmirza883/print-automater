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
import { PrismaService } from "@print-automated/backend-shared";
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

  async function createOrder(
    status: OrderStatus,
    ageMinutes: number,
    jobStatus?: PrintJobStatus,
  ): Promise<string> {
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
    // Same test-only backdating as 5.6's own fixture -- orders only
    // ever change via OrderStateMachine.transition() in real code,
    // which is what makes updated_at a reliable "how long in this
    // status" proxy to simulate without an actual wait.
    await prisma.$executeRaw`
      UPDATE orders SET updated_at = NOW() - (${ageMinutes} * INTERVAL '1 minute') WHERE id = ${order.id}
    `;
    if (jobStatus) {
      await prisma.printJob.create({
        data: {
          orderId: order.id,
          printerId,
          shopId,
          status: jobStatus,
          idempotencyToken: randomUUID(),
        },
      });
    }
    return order.id;
  }

  it("§109: a QUEUED_FOR_PRINT order past the timeout fails to PRINT_FAILED and its job is marked TIMEOUT; a recent one and a different-status one are untouched", async () => {
    const staleId = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.QUEUED);
    const freshId = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 1, PrintJobStatus.QUEUED);
    const differentStatusId = await createOrder(OrderStatus.SHOP_ACCEPTED, 999);

    await processor.process(fakeJob);

    const [stale, fresh, differentStatus] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: staleId } }),
      prisma.order.findUniqueOrThrow({ where: { id: freshId } }),
      prisma.order.findUniqueOrThrow({ where: { id: differentStatusId } }),
    ]);
    expect(stale.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    expect(fresh.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
    expect(differentStatus.orderStatus).toBe(OrderStatus.SHOP_ACCEPTED);

    const staleJob = await prisma.printJob.findFirstOrThrow({ where: { orderId: staleId } });
    expect(staleJob.status).toBe(PrintJobStatus.TIMEOUT);
  });

  it("§109: a job an agent claimed but never reported on also times out (not just an unclaimed one)", async () => {
    const claimedId = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.CLAIMED);

    await processor.process(fakeJob);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: claimedId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    const job = await prisma.printJob.findFirstOrThrow({ where: { orderId: claimedId } });
    expect(job.status).toBe(PrintJobStatus.TIMEOUT);
  });

  it("§109's own Done-when: a time-travelled order times out exactly once and is not double-processed on the next tick", async () => {
    const orderId = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.QUEUED);

    const first = await processor.process(fakeJob);
    expect(first.timedOutCount).toBeGreaterThanOrEqual(1);

    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterFirst.orderStatus).toBe(OrderStatus.PRINT_FAILED);

    const second = await processor.process(fakeJob);
    expect(second.timedOutCount).toBe(0);

    const failAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_FAIL_PRINT" },
    });
    expect(failAudits).toBe(1);
  });

  it("§109: two overlapping ticks racing the same stale order still time it out exactly once", async () => {
    const orderId = await createOrder(OrderStatus.QUEUED_FOR_PRINT, 999, PrintJobStatus.QUEUED);

    const [a, b] = await Promise.all([processor.process(fakeJob), processor.process(fakeJob)]);
    expect(a.timedOutCount + b.timedOutCount).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);

    const failAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_FAIL_PRINT" },
    });
    expect(failAudits).toBe(1);
  });
});
