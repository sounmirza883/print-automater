import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Controller, HttpCode, HttpStatus, Post, Req, type RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
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

interface ReceivedWebhook {
  rawBody: Buffer;
  signature: string | undefined;
}

/** Stands in for 6.5's real `/webhooks/payment/mock` endpoint, which
 * doesn't exist yet -- same "build the general mechanism now, apply it
 * to the real endpoint once it exists" split 5.3 used for the
 * idempotency interceptor. Captures the exact bytes and signature
 * header it received so the test can independently verify them
 * through MockPaymentProvider's own verifyWebhook(), proving the round
 * trip really works over real HTTP. */
@Controller("webhooks/payment")
class ThrowawayWebhookReceiver {
  received: ReceivedWebhook[] = [];

  @Post("mock")
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: RawBodyRequest<Request>): { ok: true } {
    this.received.push({
      rawBody: req.rawBody ?? Buffer.alloc(0),
      signature: req.headers["x-mock-signature"] as string | undefined,
    });
    return { ok: true };
  }
}

describe("MockPaymentProvider + dev checkout page (6.3, e2e)", () => {
  let app: NestExpressApplication;
  let provider: MockPaymentProvider;
  let receiver: ThrowawayWebhookReceiver;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrowawayWebhookReceiver],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    await app.listen(TEST_PORT);

    provider = app.get(MockPaymentProvider);
    receiver = moduleRef.get(ThrowawayWebhookReceiver);
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    receiver.received = [];
  });

  it("createCheckout returns a real, reachable page listing Pay/Fail/Abandon", async () => {
    const session = await provider.createCheckout({
      orderId: "order-1",
      amountMinor: 5000,
      currency: "PKR",
    });
    expect(session.providerPaymentId).toMatch(/^mock_/);
    expect(session.checkoutUrl).toContain(`${baseUrl}/v1/payments/mock/checkout`);

    const res = await request(app.getHttpServer()).get(session.checkoutUrl.replace(baseUrl, ""));
    expect(res.status).toBe(200);
    expect(res.text).toContain("Pay");
    expect(res.text).toContain("Fail");
    expect(res.text).toContain("Abandon");
  });

  it("§76: clicking Pay delivers a genuinely HMAC-signed webhook to the real endpoint, verifiable by the provider's own verifyWebhook", async () => {
    const session = await provider.createCheckout({
      orderId: "order-2",
      amountMinor: 7000,
      currency: "PKR",
    });

    const res = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${session.providerPaymentId}&outcome=PAID`,
    );
    expect(res.status).toBe(200);

    expect(receiver.received).toHaveLength(1);
    const delivered = receiver.received[0]!;
    expect(delivered.signature).toBeDefined();

    const verified = provider.verifyWebhook(delivered.rawBody, delivered.signature!);
    expect(verified).toMatchObject({
      valid: true,
      event: { providerPaymentId: session.providerPaymentId, outcome: "PAID" },
    });
  });

  it("a tampered signature is rejected by verifyWebhook", async () => {
    const session = await provider.createCheckout({
      orderId: "order-3",
      amountMinor: 1000,
      currency: "PKR",
    });
    await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${session.providerPaymentId}&outcome=PAID`,
    );
    const delivered = receiver.received[0]!;
    const tampered = provider.verifyWebhook(
      delivered.rawBody,
      "0".repeat(delivered.signature!.length),
    );
    expect(tampered).toEqual({ valid: false });
  });

  it("Fail and Abandon map to FAILED and CANCELLED outcomes, each independently signed and verifiable", async () => {
    const failSession = await provider.createCheckout({
      orderId: "order-4",
      amountMinor: 1000,
      currency: "PKR",
    });
    await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${failSession.providerPaymentId}&outcome=FAILED`,
    );
    expect(
      provider.verifyWebhook(receiver.received[0]!.rawBody, receiver.received[0]!.signature!),
    ).toMatchObject({ valid: true, event: { outcome: "FAILED" } });

    receiver.received = [];
    const abandonSession = await provider.createCheckout({
      orderId: "order-5",
      amountMinor: 1000,
      currency: "PKR",
    });
    await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${abandonSession.providerPaymentId}&outcome=CANCELLED`,
    );
    expect(
      provider.verifyWebhook(receiver.received[0]!.rawBody, receiver.received[0]!.signature!),
    ).toMatchObject({ valid: true, event: { outcome: "CANCELLED" } });
  });

  it("§92/10.6: replay resends the exact same event -- byte-identical body and signature, not a freshly re-signed equivalent", async () => {
    const session = await provider.createCheckout({
      orderId: "order-6",
      amountMinor: 2500,
      currency: "PKR",
    });
    await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${session.providerPaymentId}&outcome=PAID`,
    );
    const original = receiver.received[0]!;

    await request(app.getHttpServer()).get(
      `/v1/payments/mock/replay?providerPaymentId=${session.providerPaymentId}`,
    );
    expect(receiver.received).toHaveLength(2);
    const replayed = receiver.received[1]!;

    expect(replayed.rawBody.equals(original.rawBody)).toBe(true);
    expect(replayed.signature).toBe(original.signature);
  });

  it("replaying a payment with no prior event is refused", async () => {
    const res = await request(app.getHttpServer()).get(
      `/v1/payments/mock/replay?providerPaymentId=mock_${randomUUID()}`,
    );
    expect(res.status).toBe(404);
  });

  it("out-of-order delivery: resolving Fail after an already-resolved Pay produces two distinct, independently valid events -- the mock enforces no ordering of its own", async () => {
    const session = await provider.createCheckout({
      orderId: "order-7",
      amountMinor: 3000,
      currency: "PKR",
    });

    const paid = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${session.providerPaymentId}&outcome=PAID`,
    );
    const failed = await request(app.getHttpServer()).get(
      `/v1/payments/mock/resolve?providerPaymentId=${session.providerPaymentId}&outcome=FAILED`,
    );
    expect(paid.status).toBe(200);
    expect(failed.status).toBe(200);
    expect(receiver.received).toHaveLength(2);

    const [first, second] = receiver.received;
    const firstEvent = provider.verifyWebhook(first!.rawBody, first!.signature!);
    const secondEvent = provider.verifyWebhook(second!.rawBody, second!.signature!);
    expect(firstEvent).toMatchObject({ valid: true, event: { outcome: "PAID" } });
    expect(secondEvent).toMatchObject({ valid: true, event: { outcome: "FAILED" } });
    // Two distinct provider event ids -- ordering/deduplication at
    // delivery is 6.5/6.6's job at the receiving end, not something
    // the mock itself prevents from being constructed in the first
    // place (a real PSP's webhooks can arrive out of order too).
    if (firstEvent.valid && secondEvent.valid) {
      expect(firstEvent.event.providerEventId).not.toBe(secondEvent.event.providerEventId);
    }
  });

  it("an unknown outcome is rejected with 400", async () => {
    const res = await request(app.getHttpServer()).get(
      "/v1/payments/mock/resolve?providerPaymentId=mock_x&outcome=NOT_A_REAL_OUTCOME",
    );
    expect(res.status).toBe(400);
  });
});
