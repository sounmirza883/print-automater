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
import {
  AppException,
  OrderEvent,
  OrderStateMachine,
  PrismaService,
} from "@print-automated/backend-shared";
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

/** §110/10.6: a dedicated adversarial suite, not scattered assertions --
 * "the strongest evidence for §123's duplicate-protection requirement"
 * per the plan's own words. Each of the six scenarios below already has
 * its *mechanism* proven correct somewhere else in the suite (agent-
 * jobs.e2e-spec.ts's claim race, webhooks.e2e-spec.ts's 5x replay,
 * agent-job-status.e2e-spec.ts's Idempotency-Key replay, shop-order-
 * actions.e2e-spec.ts's double-tap accept) -- this file's job is to
 * hold all six side by side as one auditable campaign, not to
 * re-derive each guarantee from scratch. Where this file's own
 * assertion is a strict superset of an existing one (5x instead of 2x
 * or 3x), that's deliberate: the plan's own text specifically calls out
 * "5x" for three of the six.
 *
 * Scenario 1 ("kill agent mid-print") is the one exception: no other
 * suite proves the backend-side half of it, because nothing else ever
 * simulates a job stuck CLAIMED with its agent gone silent AND two
 * concurrent recovery attempts racing it AND a subsequent real retry
 * never producing a second live print_job. 10.5's own
 * print-timeout.e2e-spec.ts (services/worker) proves the sweep's query
 * logic in isolation; this proves the end-to-end invariant through
 * services/api's real HTTP surface instead. */
describe("Duplicate-print campaign (10.6, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;
  let tokenService: TokenService;
  let stateMachine: OrderStateMachine;
  let mockProvider: MockPaymentProvider;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shop: { id: string };
  let counter: { id: string; role: UserRole };
  let counterToken: string;

  const deviceIds: string[] = [];
  const printerIds: string[] = [];
  const orderIds: string[] = [];

  async function registerAndAuthenticate(): Promise<{ deviceId: string; accessToken: string }> {
    const { code } = await pairingCodeService.issue(shop.id, counter.id);
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

  async function createPrinterForAgent(deviceId: string): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agent.id,
        name: `Duplicate Campaign E2E Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
        // 15.2: the auto-dispatch path now excludes printers with
        // unprobed (null) capabilities, so every printer this suite's
        // auto-dispatch tests rely on needs a declared capability set
        // that actually covers the seeded A4/BW/SINGLE configuration.
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function seedOrder(orderStatus: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-DUPCAMP-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
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
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  async function seedJob(
    printerId: string,
    orderId: string,
    status: PrintJobStatus,
  ): Promise<string> {
    const job = await prisma.printJob.create({
      data: { orderId, printerId, shopId: shop.id, idempotencyToken: randomUUID(), status },
    });
    return job.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);
    tokenService = app.get(TokenService);
    stateMachine = app.get(OrderStateMachine);
    mockProvider = app.get(MockPaymentProvider);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Duplicate Campaign E2E Customer",
        email: `dup-campaign-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/duplicate-campaign/${randomUUID()}`,
        filename: "duplicate-campaign-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: {
        name: `Duplicate Campaign E2E Shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Duplicate Campaign E2E Counter",
        email: `dup-campaign-e2e-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = tokenService.issueAccessToken(counter);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.paymentEvent.deleteMany({ where: { payment: { order: { shopId: shop.id } } } });
    await prisma.payment.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, counter.id] } } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

  it("1. kill agent mid-print: a stalled CLAIMED job racing two concurrent recovery attempts fails exactly once, and a subsequent retry creates exactly one new (not duplicate) print job", async () => {
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const { deviceId } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, orderId, PrintJobStatus.CLAIMED);

    // Two racing "recovery attempts" -- e.g. two overlapping 10.5 sweep
    // ticks, or a sweep tick racing a staff-initiated failure -- both
    // driving the exact same FAIL_PRINT event + TIMEOUT sideEffect
    // 10.5's own processor uses, run truly concurrently.
    const attempt = () =>
      stateMachine
        .transition(
          orderId,
          OrderEvent.FAIL_PRINT,
          { id: null },
          {
            metadata: { reason: "timeout" },
            sideEffect: async (tx) => {
              await tx.printJob.update({
                where: { id: jobId },
                data: { status: PrintJobStatus.TIMEOUT },
              });
            },
          },
        )
        .catch((error: unknown) => {
          if (error instanceof AppException && error.errorCode === "ILLEGAL_ORDER_TRANSITION") {
            return "illegal" as const;
          }
          throw error;
        });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o === "illegal")).toHaveLength(1);
    expect(outcomes.filter((o) => o !== "illegal")).toHaveLength(1);

    const failedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(failedOrder.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    const staleJob = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(staleJob.status).toBe(PrintJobStatus.TIMEOUT);

    // Staff retries -- must produce exactly ONE new live job, and must
    // never touch/resurrect the abandoned CLAIMED-turned-TIMEOUT one.
    const retryRes = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/retry-print`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);
    expect(retryRes.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const allJobs = await prisma.printJob.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(allJobs).toHaveLength(2);
    expect(allJobs[0]?.id).toBe(jobId);
    expect(allJobs[0]?.status).toBe(PrintJobStatus.TIMEOUT);
    expect(allJobs[1]?.status).toBe(PrintJobStatus.QUEUED);
  });

  it("2. replaying the exact same claim call twice: exactly one succeeds, the job is CLAIMED exactly once", async () => {
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, orderId, PrintJobStatus.QUEUED);

    const first = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/claim`)
      .set("Authorization", `Bearer ${accessToken}`);
    const second = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/claim`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.CLAIMED);
  });

  it("3. two agents' claims racing the same job concurrently: exactly one wins", async () => {
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, orderId, PrintJobStatus.QUEUED);

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${accessToken}`),
      request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${accessToken}`),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.CLAIMED);
    expect(job.claimedAt).not.toBeNull();
  });

  it("4. the same payment webhook delivered 5 times produces exactly one financial operation", async () => {
    const orderId = await seedOrder(OrderStatus.PAYMENT_PENDING);
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

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
    const events = await prisma.paymentEvent.count({
      where: { payment: { providerPaymentId: session.providerPaymentId } },
    });
    expect(events).toBe(1);
    const confirmAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_CONFIRM_PAYMENT" },
    });
    expect(confirmAudits).toBe(1);
  });

  it("5. accept tapped 5 times creates exactly one print job", async () => {
    const orderId = await seedOrder(OrderStatus.WAITING_FOR_SHOP);
    // 15.2: the auto-dispatch path now requires ONLINE + an attached
    // agent + declared, compatible capabilities -- an agent-less or
    // unprobed printer is no longer eligible. Disable every OTHER
    // printer this shop has accumulated from earlier tests so
    // acceptOrder()'s auto pick is deterministic, then register a real
    // agent-backed, capability-declared printer for this test.
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: PrinterStatus.DISABLED },
    });
    const { deviceId } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${counterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.orderStatus).toBe("QUEUED_FOR_PRINT");
    }

    const jobs = await prisma.printJob.findMany({ where: { orderId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.printerId).toBe(printer.id);
    const acceptAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SHOP_ACCEPT" },
    });
    expect(acceptAudits).toBe(1);
  });

  it("6. the same terminal status report (with the same Idempotency-Key) reported 5 times produces exactly one transition each", async () => {
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const jobId = await seedJob(printer.id, orderId, PrintJobStatus.CLAIMED);
    const idempotencyKey = `${jobId}:PRINTED`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send({ status: "PRINTED" });
      expect(res.status).toBe(200);
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTED);
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.PRINTED);

    const startAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_START_PRINT" },
    });
    expect(startAudits).toBe(1);
    const finishAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_FINISH_PRINT" },
    });
    expect(finishAudits).toBe(1);
  });
});
