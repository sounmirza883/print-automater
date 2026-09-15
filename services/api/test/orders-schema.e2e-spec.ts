import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DocumentStatus, OrderStatus, PaymentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";

/** §5.1's own Done-when: the migration applies, and payment_status and
 * order_status are each independently indexed -- verified two ways:
 * directly against pg_indexes (the actual DDL outcome, not just that
 * Prisma's schema.prisma *says* @@index), and behaviorally (querying
 * by one status never requires or implies the other, matching §26's
 * "payment and order state separation"). */
describe("Orders schema (5.1, e2e)", () => {
  let prisma: PrismaService;
  let userId: string;
  let shopId: string;
  let documentId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Orders Schema E2E",
        email: `orders-schema-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userId = user.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Orders Schema E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: userId,
        storageKey: `documents/${randomUUID()}`,
        filename: "orders-schema-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
        checksum: "irrelevant-for-this-test",
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("applies: an order can be created with print_configuration and pricing_snapshot JSONB, and separate status columns", async () => {
    const printConfiguration = {
      pages: { mode: "all" },
      copies: 2,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };
    const pricingSnapshot = {
      lineItems: [{ label: "Page price", amountMinor: 5000 }],
      subtotalMinor: 5000,
      platformFeeMinor: 2000,
      totalMinor: 7000,
      currency: "PKR",
    };

    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `PA-SCHEMATEST-${randomUUID()}`,
        customerId: userId,
        shopId,
        documentId,
        printConfiguration,
        pricingSnapshot,
        // S26's own example: PAID payment alongside a non-PAID order
        // status is a valid, expected combination, not a contradiction.
        paymentStatus: PaymentStatus.PAID,
        orderStatus: OrderStatus.PRINT_FAILED,
      },
    });
    orderId = order.id;

    expect(order.printConfiguration).toEqual(printConfiguration);
    expect(order.pricingSnapshot).toEqual(pricingSnapshot);
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);
  });

  it("payment_status and order_status are each independently indexed", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'orders'
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("orders_payment_status_idx");
    expect(names).toContain("orders_order_status_idx");
  });

  it("§26: payment and order status are queryable completely independently of one another", async () => {
    const byPaymentStatus = await prisma.order.findMany({
      where: { paymentStatus: PaymentStatus.PAID },
      select: { id: true, orderStatus: true },
    });
    const thisOrder = byPaymentStatus.find((row) => row.id === orderId);
    expect(thisOrder).toBeDefined();
    // Found via payment_status alone; its order_status is whatever it
    // independently is (PRINT_FAILED here), not constrained by the query.
    expect(thisOrder?.orderStatus).toBe(OrderStatus.PRINT_FAILED);

    const byOrderStatus = await prisma.order.findMany({
      where: { orderStatus: OrderStatus.PRINT_FAILED },
      select: { id: true, paymentStatus: true },
    });
    const sameOrder = byOrderStatus.find((row) => row.id === orderId);
    expect(sameOrder?.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it("public_order_number is unique", async () => {
    const duplicateNumber = `PA-DUPTEST-${randomUUID()}`;
    await prisma.order.create({
      data: {
        publicOrderNumber: duplicateNumber,
        customerId: userId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
      },
    });

    await expect(
      prisma.order.create({
        data: {
          publicOrderNumber: duplicateNumber,
          customerId: userId,
          shopId,
          documentId,
          printConfiguration: {},
          pricingSnapshot: {},
        },
      }),
    ).rejects.toThrow();

    await prisma.order.deleteMany({ where: { publicOrderNumber: duplicateNumber } });
  });

  it("order_number_counters and idempotency_keys exist and enforce their own constraints", async () => {
    const dateKey = `schema-test-${randomUUID()}`;
    const counter = await prisma.orderNumberCounter.create({ data: { dateKey, counter: 1 } });
    expect(counter.counter).toBe(1);
    await prisma.orderNumberCounter.delete({ where: { dateKey } });

    const key = randomUUID();
    const scope = "POST /v1/orders";
    await prisma.idempotencyKey.create({
      data: { key, scope, requestHash: "hash-1", responseStatus: 201, responseBody: { ok: true } },
    });
    // (key, scope) is unique -- the same key replayed under the same
    // scope must be refused at the DB level too, not just by whatever
    // application code checks first.
    await expect(
      prisma.idempotencyKey.create({
        data: {
          key,
          scope,
          requestHash: "hash-2",
          responseStatus: 201,
          responseBody: { ok: true },
        },
      }),
    ).rejects.toThrow();
    await prisma.idempotencyKey.deleteMany({ where: { key, scope } });
  });
});
