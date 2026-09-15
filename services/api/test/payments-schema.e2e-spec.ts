import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DocumentStatus, PaymentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";

/** §6.1's own Done-when: "Inserting a duplicate event id raises a
 * constraint violation" -- the database is the idempotency backstop
 * for §76/§92's webhook requirements, not application logic alone. */
describe("Payments schema (6.1, e2e)", () => {
  let prisma: PrismaService;
  let userId: string;
  let shopId: string;
  let documentId: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Payments Schema E2E",
        email: `payments-schema-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userId = user.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Payments Schema E2E Shop ${randomUUID()}`,
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
        filename: "payments-schema-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
        checksum: "irrelevant-for-this-test",
      },
    });
    documentId = document.id;

    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `PA-PAYSCHEMA-${randomUUID()}`,
        customerId: userId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.paymentEvent.deleteMany({ where: { paymentId } });
    await prisma.payment.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("applies: a payment can be created against an order, with an integer amount_minor and a default PENDING status", async () => {
    const payment = await prisma.payment.create({
      data: {
        orderId,
        provider: "mock",
        amountMinor: 20000,
        currency: "PKR",
      },
    });
    paymentId = payment.id;

    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.amountMinor).toBe(20000);
    expect(payment.providerPaymentId).toBeNull();
  });

  it("payments.order_id and payments.status are each indexed", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'payments'
    `;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("payments_order_id_idx");
    expect(names).toContain("payments_status_idx");
  });

  it("§58/§76/§92: a duplicate provider_event_id raises a constraint violation, at the database level", async () => {
    const providerEventId = `evt_${randomUUID()}`;
    await prisma.paymentEvent.create({
      data: { paymentId, providerEventId, eventType: "payment.succeeded" },
    });

    await expect(
      prisma.paymentEvent.create({
        data: { paymentId, providerEventId, eventType: "payment.succeeded" },
      }),
    ).rejects.toThrow();

    const count = await prisma.paymentEvent.count({ where: { providerEventId } });
    expect(count).toBe(1);
  });
});
