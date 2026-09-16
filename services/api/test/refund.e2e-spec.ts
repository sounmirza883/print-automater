import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, PaymentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { MockPaymentProvider } from "../src/payments/mock-payment-provider.js";
import { RefundService } from "../src/payments/refund.service.js";

/** §80/11.2, e2e: the refund state machine (REFUND_PENDING -> REFUNDED,
 * failure REFUND_FAILED) against real Postgres and Redis (OrderLockService's
 * own lock, not mocked -- the same "prove concurrency against the real
 * thing" standard 6.5's webhook suite and 9.7's claim suite already
 * hold to). */
describe("RefundService (11.2, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let refundService: RefundService;
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
    refundService = app.get(RefundService);
    provider = app.get(MockPaymentProvider);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Refund E2E Customer",
        email: `refund-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Refund E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/refund/${randomUUID()}`,
        filename: "refund-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.refund.deleteMany({ where: { order: { shopId } } });
    await prisma.payment.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  async function createPaidPayment(): Promise<{ paymentId: string; orderId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-REFUND-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
        paymentStatus: PaymentStatus.PAID,
      },
    });
    const session = await provider.createCheckout({
      orderId: order.id,
      amountMinor: 2000,
      currency: "PKR",
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 2000,
        currency: "PKR",
        status: PaymentStatus.PAID,
      },
    });
    return { paymentId: payment.id, orderId: order.id };
  }

  it("requests a refund that succeeds, linking the record to both payment and order and syncing their status", async () => {
    const { paymentId, orderId } = await createPaidPayment();

    const refund = await refundService.requestRefund(paymentId, "customer_cancellation", null);

    expect(refund.status).toBe(PaymentStatus.REFUNDED);
    expect(refund.paymentId).toBe(paymentId);
    expect(refund.orderId).toBe(orderId);
    expect(refund.providerRefundId).not.toBeNull();
    expect(refund.reason).toBe("customer_cancellation");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });

  it("§80's own Done-when: a refund requested twice (sequentially) produces one provider call and one refund record", async () => {
    const { paymentId } = await createPaidPayment();
    const refundSpy = jest.spyOn(provider, "refund");

    const first = await refundService.requestRefund(paymentId, "shop_rejection", null);
    const second = await refundService.requestRefund(paymentId, "shop_rejection", null);

    expect(first.id).toBe(second.id);
    expect(second.status).toBe(PaymentStatus.REFUNDED);
    expect(refundSpy).toHaveBeenCalledTimes(1);

    const rows = await prisma.refund.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(1);
    refundSpy.mockRestore();
  });

  it("two genuinely concurrent refund requests for the same payment still produce exactly one provider call and one record", async () => {
    const { paymentId } = await createPaidPayment();
    const refundSpy = jest.spyOn(provider, "refund");

    // OrderLockService fails fast (409) rather than blocking a losing
    // caller open (the same documented tradeoff webhooks.e2e-spec.ts's
    // own concurrent test already exercises) -- so unlike
    // OrderStateMachine's Postgres row lock, it's not guaranteed both
    // callers here resolve successfully. What must hold regardless of
    // which one wins the lock is no duplicate provider call and no
    // duplicate record.
    const results = await Promise.allSettled([
      refundService.requestRefund(paymentId, "customer_cancellation", null),
      refundService.requestRefund(paymentId, "customer_cancellation", null),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ errorCode: "ORDER_LOCK_CONTENDED" });
      }
    }
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    const rows = await prisma.refund.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(1);
    refundSpy.mockRestore();
  });

  it("a provider failure is recorded as REFUND_FAILED (data, not a thrown error) and syncs payment/order status", async () => {
    const { paymentId, orderId } = await createPaidPayment();
    const refundSpy = jest
      .spyOn(provider, "refund")
      .mockRejectedValueOnce(new Error("provider down"));

    const refund = await refundService.requestRefund(paymentId, "shop_rejection", null);

    expect(refund.status).toBe(PaymentStatus.REFUND_FAILED);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.REFUND_FAILED);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe(PaymentStatus.REFUND_FAILED);
    refundSpy.mockRestore();
  });

  it("retrying a REFUND_FAILED refund tries the provider again and can succeed on retry, still using the same record", async () => {
    const { paymentId } = await createPaidPayment();
    const refundSpy = jest
      .spyOn(provider, "refund")
      .mockRejectedValueOnce(new Error("provider down"));

    const failed = await refundService.requestRefund(paymentId, "shop_rejection", null);
    expect(failed.status).toBe(PaymentStatus.REFUND_FAILED);

    const retried = await refundService.requestRefund(paymentId, "shop_rejection", null);
    expect(retried.id).toBe(failed.id);
    expect(retried.status).toBe(PaymentStatus.REFUNDED);
    expect(refundSpy).toHaveBeenCalledTimes(2);

    const rows = await prisma.refund.findMany({ where: { paymentId } });
    expect(rows).toHaveLength(1);
    refundSpy.mockRestore();
  });

  it("refuses to refund a payment that never reached the provider", async () => {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-REFUND-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {},
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        amountMinor: 1000,
        currency: "PKR",
      },
    });

    await expect(refundService.requestRefund(payment.id, "shop_rejection", null)).rejects.toThrow();

    const rows = await prisma.refund.findMany({ where: { paymentId: payment.id } });
    expect(rows).toHaveLength(0);
  });
});
