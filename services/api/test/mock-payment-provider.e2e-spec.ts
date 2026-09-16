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

/** jest.setup.cjs pins every e2e file's API_PUBLIC_BASE_URL to this
 * exact address -- MockCheckoutController's resolve/replay handlers
 * make a *real* outbound HTTP call for webhook delivery (§76: this has
 * to be the identical code path a real PSP's webhook would take, not
 * an in-process function call standing in for one), which needs a
 * genuinely listening, reachable server, not just supertest's
 * in-memory dispatch. */
const TEST_PORT = 4090;

/** 6.5 now owns the real `/webhooks/payment/mock` endpoint this file
 * used to stand in for with a throwaway receiver -- that receiver has
 * been removed (it would now collide with the real route), and every
 * test below delivers through, and asserts against, the real endpoint
 * and real database state, not captured bytes. Idempotency/replay and
 * out-of-order-delivery semantics are exercised more thoroughly by
 * 6.5's own webhooks.e2e-spec.ts, which owns those properties now that
 * something real implements them; this file stays focused on the mock
 * provider's own mechanics -- the checkout page, and each outcome
 * mapping to the correct real effect. */
describe("MockPaymentProvider + dev checkout page (6.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let provider: MockPaymentProvider;
  let baseUrl: string;
  let customerId: string;
  let shopId: string;
  let documentId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    await app.listen(TEST_PORT);

    prisma = app.get(PrismaService);
    provider = app.get(MockPaymentProvider);
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Mock Provider E2E Customer",
        email: `mock-provider-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;

    const shop = await prisma.shop.create({
      data: {
        name: `Mock Provider E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;

    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/mock-payment-provider/${randomUUID()}`,
        filename: "mock-provider-test.pdf",
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
    // 7.3: a successful PAID/PAYMENT_FAILED transition now creates
    // notifications rows referencing the order -- delete those first.
    await prisma.notification.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shop.delete({ where: { id: shopId } });
    await prisma.user.delete({ where: { id: customerId } });
    await app.close();
  });

  /** A real order already in PAYMENT_PENDING (as 6.4's checkout
   * endpoint would leave it) with a real payment row backing a fresh
   * mock checkout session -- everything the real webhook endpoint
   * needs to actually apply an incoming event, not just accept the
   * HTTP call. */
  async function createPendingPayment(
    amountMinor = 1000,
  ): Promise<{ orderId: string; providerPaymentId: string; checkoutUrl: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-MOCK-${randomUUID()}`,
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
      amountMinor,
      currency: "PKR",
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor,
        currency: "PKR",
      },
    });
    return {
      orderId: order.id,
      providerPaymentId: session.providerPaymentId,
      checkoutUrl: session.checkoutUrl,
    };
  }

  it("createCheckout returns a real, reachable page listing Pay/Fail/Abandon", async () => {
    const { checkoutUrl } = await createPendingPayment();
    expect(checkoutUrl).toContain(`${baseUrl}/v1/payments/mock/checkout`);

    const res = await request(app.getHttpServer()).get(checkoutUrl.replace(baseUrl, ""));
    expect(res.status).toBe(200);
    expect(res.text).toContain("Pay");
    expect(res.text).toContain("Fail");
    expect(res.text).toContain("Abandon");
  });

  it("§76: clicking Pay delivers a genuinely HMAC-signed webhook to the real endpoint, which confirms the payment and the order", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();

    const res = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${providerPaymentId}&outcome=PAID`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("Webhook delivery: 200");

    // §6.6: routed straight on to WAITING_FOR_SHOP, not left at PAID.
    // §26: orders.payment_status mirrors the payment's own status too.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
    expect(payment.status).toBe(PaymentStatus.PAID);
  });

  it("Fail and Abandon are each delivered and mapped to FAILED/CANCELLED on the payment, and PAYMENT_FAILED on the order", async () => {
    const { orderId: failOrderId, providerPaymentId: failPaymentId } = await createPendingPayment();
    const failRes = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${failPaymentId}&outcome=FAILED`,
    );
    expect(failRes.text).toContain("Webhook delivery: 200");
    const failOrder = await prisma.order.findUniqueOrThrow({ where: { id: failOrderId } });
    expect(failOrder.orderStatus).toBe(OrderStatus.PAYMENT_FAILED);
    expect(failOrder.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: failPaymentId } }))
        .status,
    ).toBe(PaymentStatus.FAILED);

    const { orderId: abandonOrderId, providerPaymentId: abandonPaymentId } =
      await createPendingPayment();
    const abandonRes = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${abandonPaymentId}&outcome=CANCELLED`,
    );
    expect(abandonRes.text).toContain("Webhook delivery: 200");
    const abandonOrder = await prisma.order.findUniqueOrThrow({ where: { id: abandonOrderId } });
    expect(abandonOrder.orderStatus).toBe(OrderStatus.PAYMENT_FAILED);
    expect(abandonOrder.paymentStatus).toBe(PaymentStatus.CANCELLED);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId: abandonPaymentId } }))
        .status,
    ).toBe(PaymentStatus.CANCELLED);
  });

  it("a tampered signature is rejected by the real endpoint with 401, and changes nothing", async () => {
    const { orderId, providerPaymentId } = await createPendingPayment();

    const res = await request(app.getHttpServer())
      .post("/v1/webhooks/payment/mock")
      .set("x-mock-signature", "0".repeat(64))
      .send({
        providerEventId: `evt_${randomUUID()}`,
        eventType: "payment.paid",
        providerPaymentId,
        outcome: "PAID",
      });
    expect(res.status).toBe(401);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAYMENT_PENDING);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerPaymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  it("replaying a payment with no prior event is refused", async () => {
    const res = await request(app.getHttpServer()).get(
      `/v1/payments/mock/replay?providerPaymentId=mock_${randomUUID()}`,
    );
    expect(res.status).toBe(404);
  });

  it("an unknown outcome is rejected with 400", async () => {
    const res = await request(app.getHttpServer()).get(
      "/v1/payments/mock/resolve?providerPaymentId=mock_x&outcome=NOT_A_REAL_OUTCOME",
    );
    expect(res.status).toBe(400);
  });
});
