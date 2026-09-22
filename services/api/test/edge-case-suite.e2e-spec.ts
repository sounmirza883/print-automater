import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  PrinterStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AgentPairingCodeService } from "../src/shop-agents/agent-pairing-code.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { MockPaymentProvider } from "../src/payments/mock-payment-provider.js";

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

/** §122/13.2: the seven named scenarios, gathered into one auditable
 * suite -- the same "hold them side by side" reasoning 10.6's own
 * duplicate-print campaign already established for this codebase.
 * Three of the seven (#2, #5, #6) already have their exact mechanism
 * proven in a dedicated file (shop-order-actions.e2e-spec.ts,
 * webhooks.e2e-spec.ts, authorization-matrix.e2e-spec.ts respectively)
 * -- re-asserted here at the same weight, not skipped, matching how
 * 10.6 itself re-runs mechanisms proven elsewhere rather than only
 * cross-referencing them. The other four (#1, #3, #4, #7) had no
 * existing test asserting the named scenario end-to-end and are new. */
describe("Edge case suite (13.2, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;
  let tokenService: TokenService;
  let mockProvider: MockPaymentProvider;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shopA: { id: string };
  let shopB: { id: string };
  let counterA: { id: string; role: UserRole };
  let counterB: { id: string; role: UserRole };
  let counterAToken: string;

  const deviceIds: string[] = [];
  const printerIds: string[] = [];
  const orderIds: string[] = [];

  async function registerAndAuthenticate(
    shopId: string,
    counterId: string,
  ): Promise<{ deviceId: string; accessToken: string }> {
    const { code } = await pairingCodeService.issue(shopId, counterId);
    const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
    const deviceId = randomUUID();
    deviceIds.push(deviceId);

    await request(app.getHttpServer())
      .post("/v1/agents/register")
      .send({ pairingCode: code, deviceId, publicKey: publicKeyBase64Url })
      .expect(201);

    const challenge = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    const signature = signNonce(privateKey, challenge.body.nonce as string);
    const auth = await request(app.getHttpServer())
      .post("/v1/agents/authenticate")
      .send({ deviceId, signature });

    return { deviceId, accessToken: auth.body.accessToken as string };
  }

  async function seedOrder(
    shopId: string,
    orderStatus: OrderStatus,
    paymentStatus: PaymentStatus = PaymentStatus.PAID,
  ): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-EDGECASE-${randomUUID()}`,
        customerId: customer.id,
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
        pricingSnapshot: { quote: { totalMinor: 1500, currency: "PKR" } },
        orderStatus,
        paymentStatus,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);
    tokenService = app.get(TokenService);
    mockProvider = app.get(MockPaymentProvider);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Edge Case E2E Customer",
        email: `edge-case-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/edge-case/${randomUUID()}`,
        filename: "edge-case-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shopA = await prisma.shop.create({
      data: { name: `Edge Case E2E Shop A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Edge Case E2E Shop B ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    counterA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Edge Case E2E Counter A",
        email: `edge-case-e2e-counter-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    counterB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Edge Case E2E Counter B",
        email: `edge-case-e2e-counter-b-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopB.id,
        userId: counterB.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterAToken = tokenService.issueAccessToken(counterA);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: { in: [shopA.id, shopB.id] } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: [counterA.id, counterB.id] } } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({
      where: { id: { in: [customer.id, counterA.id, counterB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("1. payment failure -> no printing: a FAILED webhook leaves the order out of the print pipeline entirely", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.PAYMENT_PENDING, PaymentStatus.PENDING);
    const session = await mockProvider.createCheckout({
      orderId,
      amountMinor: 1500,
      currency: "PKR",
    });
    await prisma.payment.create({
      data: {
        orderId,
        provider: mockProvider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 1500,
        currency: "PKR",
      },
    });
    const entry = mockProvider.recordEvent(session.providerPaymentId, "FAILED");

    const webhookRes = await request(app.getHttpServer())
      .post("/v1/webhooks/payment/mock")
      .set("content-type", "application/json")
      .set("x-mock-signature", entry.signature)
      .send(entry.rawBody.toString("utf8"));
    expect(webhookRes.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PAYMENT_FAILED);
    expect(order.paymentStatus).toBe(PaymentStatus.FAILED);

    // No print job was ever created for this order. shop-orders.service.ts's
    // acceptOrder() deliberately swallows ILLEGAL_ORDER_TRANSITION and
    // still returns 200 (the same idempotent "already handled" pattern
    // 6.6/8.3 use elsewhere, so a double-tapped accept never surfaces
    // as an error) -- so the real guarantee isn't a specific HTTP
    // status, it's that the order can never actually be MOVED into the
    // print pipeline: it stays PAYMENT_FAILED and no print job appears,
    // no matter how many times accept is called.
    const jobCount = await prisma.printJob.count({ where: { orderId } });
    expect(jobCount).toBe(0);

    const acceptRes = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.orderStatus).toBe("PAYMENT_FAILED");
    expect(await prisma.printJob.count({ where: { orderId } })).toBe(0);
  });

  it("2. shop rejection -> notify + refund (§80/11.3's own mechanism, re-asserted here)", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP, PaymentStatus.PAID);
    const session = await mockProvider.createCheckout({
      orderId,
      amountMinor: 1500,
      currency: "PKR",
    });
    await prisma.payment.create({
      data: {
        orderId,
        provider: mockProvider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 1500,
        currency: "PKR",
        status: PaymentStatus.PAID,
      },
    });

    const rejectRes = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/reject`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ reason: "SHOP_UNAVAILABLE" });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.orderStatus).toBe("SHOP_REJECTED");

    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    expect(refund.status).toBe(PaymentStatus.REFUNDED);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { orderId, type: "ORDER_REJECTED" },
    });
    expect(notification.userId).toBe(customer.id);
  });

  it("3. printer offline -> no silent failure: an OFFLINE printer is immediately visible on the shop-facing printers list", async () => {
    const { deviceId } = await registerAndAuthenticate(shopA.id, counterA.id);
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentId: agent.id,
        name: `Edge Case Offline Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);

    // Simulates 9.4's own printer-offline-sweep having already detected
    // a stale heartbeat and flipped this printer -- that detection
    // mechanism itself is proven in printer-offline-sweep.e2e-spec.ts
    // (services/worker); this test's own job is the other half:
    // confirming that flip is actually *visible* to shop staff, not a
    // silent DB-only change nobody would ever notice.
    await prisma.printer.update({
      where: { id: printer.id },
      data: { status: PrinterStatus.OFFLINE },
    });

    const listRes = await request(app.getHttpServer())
      .get(`/v1/shop/printers?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(listRes.status).toBe(200);
    const listed = (listRes.body as Array<{ id: string; status: string }>).find(
      (p) => p.id === printer.id,
    );
    expect(listed?.status).toBe("OFFLINE");
  });

  it("4. network interruption -> reconcile, no duplicate: an agent reconnecting after going offline updates printer state without creating a duplicate print job", async () => {
    const { deviceId, accessToken: firstSessionToken } = await registerAndAuthenticate(
      shopA.id,
      counterA.id,
    );
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printerName = `Edge Case Reconnect Printer ${randomUUID()}`;
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentId: agent.id,
        name: printerName,
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);

    const orderId = await seedOrder(shopA.id, OrderStatus.QUEUED_FOR_PRINT, PaymentStatus.PAID);
    await prisma.printJob.create({
      data: {
        orderId,
        printerId: printer.id,
        shopId: shopA.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.QUEUED,
      },
    });

    // "Network interruption": the sweep already marked this OFFLINE
    // (same simulated precondition as scenario 3 -- its own detection
    // mechanism is out of this test's scope).
    await prisma.printer.update({
      where: { id: printer.id },
      data: { status: PrinterStatus.OFFLINE },
    });

    // "Reconnect": the outage is on the network path between agent and
    // backend, not the agent process itself or its own already-issued
    // token, so the SAME session's accessToken is what a real agent's
    // reconnect-backoff loop (apps/printer-agent) resumes heartbeating
    // with once connectivity returns -- re-authenticating from scratch
    // here would just re-derive the signature flow already proven in
    // agent-heartbeat.e2e-spec.ts, not add anything to what THIS
    // scenario is actually about (reconcile without duplicating state).
    const heartbeatRes = await request(app.getHttpServer())
      .post("/v1/agents/heartbeat")
      .set("Authorization", `Bearer ${firstSessionToken}`)
      .send({ printers: [{ name: printerName, status: "ONLINE" }] });
    expect(heartbeatRes.status).toBe(200);

    const reconciled = await prisma.printer.findUniqueOrThrow({ where: { id: printer.id } });
    expect(reconciled.status).toBe(PrinterStatus.ONLINE);

    // The reconnect/reconcile cycle above never touches print_jobs --
    // only accept/retry-print/resolve-unknown ever create one -- so the
    // original QUEUED job is still the only one for this order.
    const jobCount = await prisma.printJob.count({ where: { orderId } });
    expect(jobCount).toBe(1);
  });

  it("5. duplicate webhook -> processed once (§92's own mechanism, re-asserted here)", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.PAYMENT_PENDING, PaymentStatus.PENDING);
    const session = await mockProvider.createCheckout({
      orderId,
      amountMinor: 1500,
      currency: "PKR",
    });
    await prisma.payment.create({
      data: {
        orderId,
        provider: mockProvider.name,
        providerPaymentId: session.providerPaymentId,
        checkoutUrl: session.checkoutUrl,
        amountMinor: 1500,
        currency: "PKR",
      },
    });
    const entry = mockProvider.recordEvent(session.providerPaymentId, "PAID");

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer())
        .post("/v1/webhooks/payment/mock")
        .set("content-type", "application/json")
        .set("x-mock-signature", entry.signature)
        .send(entry.rawBody.toString("utf8"));
      expect(res.status).toBe(200);
    }

    const events = await prisma.paymentEvent.count({
      where: { payment: { providerPaymentId: session.providerPaymentId } },
    });
    expect(events).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
  });

  it("6. shop A -> shop B document -> denied (authorization-matrix's own mechanism, re-asserted here)", async () => {
    const { deviceId: deviceIdA } = await registerAndAuthenticate(shopA.id, counterA.id);
    const agentA = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId: deviceIdA } });
    const printerA = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentId: agentA.id,
        name: `Edge Case Printer A ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printerA.id);

    const orderId = await seedOrder(shopA.id, OrderStatus.QUEUED_FOR_PRINT, PaymentStatus.PAID);
    const job = await prisma.printJob.create({
      data: {
        orderId,
        printerId: printerA.id,
        shopId: shopA.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.CLAIMED,
      },
    });

    const { accessToken: agentBToken } = await registerAndAuthenticate(shopB.id, counterB.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/agents/jobs/${job.id}/document`)
      .set("Authorization", `Bearer ${agentBToken}`);
    expect(res.status).toBe(404);
  });

  it("7. unknown print state -> manual resolution: a real UNKNOWN report lands the order in PRINT_STATUS_UNKNOWN, and staff resolve it to a correct terminal state", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate(shopA.id, counterA.id);
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        agentId: agent.id,
        name: `Edge Case Unknown Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
        // 15.2: resolve-unknown's RETRY resolution re-dispatches
        // through the same auto-dispatch path as accept/retry-print,
        // which now excludes unprobed (null) capabilities.
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);

    const orderId = await seedOrder(shopA.id, OrderStatus.PRINTING, PaymentStatus.PAID);
    const job = await prisma.printJob.create({
      data: {
        orderId,
        printerId: printer.id,
        shopId: shopA.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.PRINTING,
      },
    });

    // Real agent report, not a directly-seeded status -- the network
    // interruption/agent-goes-silent path that actually produces
    // PRINT_STATUS_UNKNOWN in production (§47/§9.12).
    const statusRes = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${job.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${job.id}:UNKNOWN`)
      .send({ status: "UNKNOWN" });
    expect(statusRes.status).toBe(200);

    const unknownOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(unknownOrder.orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);

    // Staff resolves it -- RETRY moves the order back into the print
    // pipeline with a fresh job, the correct terminal-for-now state per
    // §47/10.3's own resolve-unknown flow.
    const resolveRes = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ resolution: "RETRY" });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const jobs = await prisma.printJob.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.status).toBe(PrintJobStatus.QUEUED);
  });
});
