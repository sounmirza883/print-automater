import "reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import { DocumentStatus, OrderStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { OrderExpirationProcessor } from "../src/order-expiration/order-expiration.processor.js";

/** 5.6's own Done-when is about the sweep's *logic* -- stale orders
 * expire, non-stale/other-status orders don't, and a race never
 * double-processes one -- not about re-proving BullMQ's own repeatable-
 * job or cross-process delivery mechanics, which 2.6's e2e test already
 * covers generically (a no-op job enqueued is consumed by a genuinely
 * separate worker process). So this drives `OrderExpirationProcessor`
 * directly through a Nest testing module, same style 5.2's and 5.4's
 * own worker-side tests use, rather than spawning a subprocess. */
describe("Order expiration sweep (5.6, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let processor: OrderExpirationProcessor;
  let customerId: string;
  let shopId: string;
  let documentId: string;
  const fakeJob = {} as Job;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    processor = app.get(OrderExpirationProcessor);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Expiration E2E Customer",
        email: `expiration-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Expiration E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/order-expiration/${randomUUID()}`,
        filename: "expiration-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  async function createOrder(status: OrderStatus, ageMinutes: number): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-EXPIRE-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: status,
      },
    });
    // Order rows only ever change via OrderStateMachine.transition() in
    // real code, which is exactly what makes `updated_at` a reliable
    // proxy for "how long has this order sat in its current status" --
    // backdating it directly here, bypassing that path, is test-only
    // scaffolding to simulate the passage of time without an actual
    // wait.
    await prisma.$executeRaw`
      UPDATE orders SET updated_at = NOW() - (${ageMinutes} * INTERVAL '1 minute') WHERE id = ${order.id}
    `;
    return order.id;
  }

  it("§108: a PAYMENT_PENDING order past the TTL expires; a recent one and a different-status one do not", async () => {
    const staleId = await createOrder(OrderStatus.PAYMENT_PENDING, 999);
    const freshId = await createOrder(OrderStatus.PAYMENT_PENDING, 1);
    const differentStatusId = await createOrder(OrderStatus.WAITING_FOR_SHOP, 999);

    await processor.process(fakeJob);

    const [stale, fresh, differentStatus] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: staleId } }),
      prisma.order.findUniqueOrThrow({ where: { id: freshId } }),
      prisma.order.findUniqueOrThrow({ where: { id: differentStatusId } }),
    ]);

    expect(stale.orderStatus).toBe(OrderStatus.EXPIRED);
    expect(fresh.orderStatus).toBe(OrderStatus.PAYMENT_PENDING);
    expect(differentStatus.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
  });

  it("§108: a time-travelled order expires exactly once and is not double-processed on the next tick", async () => {
    const orderId = await createOrder(OrderStatus.PAYMENT_PENDING, 999);

    const first = await processor.process(fakeJob);
    expect(first.expiredCount).toBeGreaterThanOrEqual(1);

    const afterFirst = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterFirst.orderStatus).toBe(OrderStatus.EXPIRED);

    // The second tick's own query no longer selects this order at all
    // (it's not PAYMENT_PENDING anymore) -- confirmed by the audit
    // trail, not just the status, so a bug that somehow re-expired it
    // via a different path would still be caught.
    const second = await processor.process(fakeJob);
    expect(second.expiredCount).toBe(0);

    const expireAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_EXPIRE" },
    });
    expect(expireAudits).toBe(1);
  });

  it("§108: two overlapping ticks racing the same stale order still expire it exactly once", async () => {
    const orderId = await createOrder(OrderStatus.PAYMENT_PENDING, 999);

    // Truly concurrent, not sequential -- OrderStateMachine's own
    // SELECT ... FOR UPDATE row lock is what has to make this safe, the
    // same guarantee 5.4's matrix test already proved for a single
    // transition; this is that guarantee exercised by two concurrent
    // *sweep* callers specifically, the scenario 5.6 actually adds.
    const [a, b] = await Promise.all([processor.process(fakeJob), processor.process(fakeJob)]);
    expect(a.expiredCount + b.expiredCount).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.EXPIRED);

    const expireAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_EXPIRE" },
    });
    expect(expireAudits).toBe(1);
  });
});
