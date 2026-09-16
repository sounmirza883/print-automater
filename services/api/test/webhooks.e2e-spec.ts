import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, OrderStatus, PaymentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { MockPaymentProvider } from "../src/payments/mock-payment-provider.js";

/** §76/§92/6.5's own Done-when: "the same webhook delivered 5 times
 * produces exactly one financial operation," and "an invalid signature
 * returns 401 and persists nothing." Delivers directly against
 * `POST /v1/webhooks/payment/mock` via supertest -- no real outbound
 * HTTP hop needed here (unlike 6.3's test), since this file *is* the
 * simulated external caller, not something asking the mock provider
 * to call itself. */
describe("POST /webhooks/payment/:provider (6.5, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let provider: MockPaymentProvider;
  let customerId: string;
  let shopId: string;
  let documentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    provider = app.get(MockPaymentProvider);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Webhooks E2E Customer",
        email: `webhooks-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Webhooks E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/webhooks/${randomUUID()}`,
        filename: "webhooks-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.paymentEvent.deleteMany({ where: { payment: { order: { shopId } } } });
    await prisma.payment.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  async function createPendingPayment(): Promise<{ orderId: string; providerPaymentId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-WEBHOOK-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: OrderStatus.PAYMENT_PENDING,
      },
    });
    const session = await provider.createCheckout({
      orderId: order.id,
      amountMinor: 1000,
      currency: "PKR",
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 1000,
        currency: "PKR",
      },
    });
    return { orderId: order.id, providerPaymentId: session.providerPaymentId };
  }

  // A plain string, not the Buffer or an object -- superagent
  // re-serializes an object via its own JSON.stringify, which could
  // (and, per this session's own earlier jsonb key-order lesson,
  // sometimes does) produce different bytes than the ones the
  // signature was actually computed over. A string with an explicit
  // JSON content-type is sent as-is, byte for byte -- the same
  // pattern app.e2e-spec.ts's own raw-body test already proved.
  function deliver(rawBody: Buffer, signature: string) {
    return request(app.getHttpServer())
      .post("/v1/webhooks/payment/mock")
      .set("content-type", "application/json")
      .set("x-mock-signature", signature)
      .send(rawBody.toString("utf8"));
  }

  it("§92: the same webhook delivered 5 times (sequentially) produces exactly one financial operation", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();
    const entry = provider.recordEvent(providerPaymentId, "PAID");

    for (let i = 0; i < 5; i += 1) {
      const res = await deliver(entry.rawBody, entry.signature);
      expect(res.status).toBe(200);
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAID);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
    const events = await prisma.paymentEvent.findMany({ where: { paymentId: payment.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.processedAt).not.toBeNull();

    // Exactly one ORDER_CONFIRM_PAYMENT audit row -- not five.
    const audits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_CONFIRM_PAYMENT" },
    });
    expect(audits).toBe(1);
  });

  it("§92: 5 genuinely concurrent deliveries of the same webhook still produce exactly one financial operation", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();
    const entry = provider.recordEvent(providerPaymentId, "PAID");

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => deliver(entry.rawBody, entry.signature)),
    );
    // Under true concurrency, a caller that loses the order-lock race
    // gets a fast 409 (§76's Redis lock deliberately fails fast rather
    // than blocking the request open -- real PSPs redeliver on a non-
    // 2xx response, so that caller simply gets retried later, by which
    // point the event is already recorded and short-circuits to 200).
    // Not every one of the 5 is guaranteed a 200 the way sequential
    // redelivery is; what must hold regardless of which responses land
    // which way is no duplicate financial operation.
    for (const res of responses) {
      expect([200, 409]).toContain(res.status);
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAID);

    const audits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_CONFIRM_PAYMENT" },
    });
    expect(audits).toBe(1);
  });

  it("an invalid signature returns 401 and persists nothing", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();
    const rawBody = Buffer.from(
      JSON.stringify({
        providerEventId: `evt_${randomUUID()}`,
        eventType: "payment.paid",
        providerPaymentId,
        outcome: "PAID",
      }),
      "utf8",
    );

    const res = await deliver(rawBody, "0".repeat(64));
    expect(res.status).toBe(401);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAYMENT_PENDING);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    const eventCount = await prisma.paymentEvent.count({ where: { paymentId: payment.id } });
    expect(eventCount).toBe(0);
  });

  it("a webhook for an unknown provider payment id is refused without crashing", async () => {
    const entry = provider.recordEvent(`mock_${randomUUID()}`, "PAID");
    const res = await deliver(entry.rawBody, entry.signature);
    expect(res.status).toBe(422);
    expect(res.body.error_code).toBe("UNKNOWN_PAYMENT");
  });

  it("a webhook for an unregistered provider name is refused", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/webhooks/payment/not-a-real-provider")
      .set("x-mock-signature", "irrelevant")
      .send({});
    expect(res.status).toBe(404);
  });

  it("§26/out-of-order delivery: a FAILED event arriving after an already-applied PAID is refused, and the order's PAID state is not corrupted", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();
    const paidEntry = provider.recordEvent(providerPaymentId, "PAID");
    const paidRes = await deliver(paidEntry.rawBody, paidEntry.signature);
    expect(paidRes.status).toBe(200);

    const failedEntry = provider.recordEvent(providerPaymentId, "FAILED");
    const failedRes = await deliver(failedEntry.rawBody, failedEntry.signature);
    expect(failedRes.status).toBe(409);
    expect(failedRes.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");

    // Still PAID -- the out-of-order FAILED never got a chance to
    // corrupt it, and the payment row still reflects the successful
    // outcome that actually applied, not the rejected later one.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAID);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
    expect(payment.status).toBe(PaymentStatus.PAID);
  });
});
