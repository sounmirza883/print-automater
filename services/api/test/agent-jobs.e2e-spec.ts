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

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

/** §9.7, e2e: long-poll + claim against real Postgres and a real
 * Redis BRPOP (not a mock) -- the interesting failure modes here
 * (a blocked connection wedging every other Redis caller, a stale
 * signal racing a re-check, two claims racing the same row) only show
 * up against the real thing. */
describe("Agent job long-poll & claim (9.7, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;
  let tokenService: TokenService;

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
        name: `Agent Jobs E2E Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
        // 15.2: the auto-dispatch path now excludes printers with
        // unprobed (null) capabilities -- this suite's own accept
        // call (the long-poll wake-up test) goes through that path.
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function seedOrder(orderStatus: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-AGENTJOBS-${randomUUID()}`,
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
        // §44/9.13: acceptOrder() now checks payment_status == PAID for
        // real -- a seeded WAITING_FOR_SHOP order needs to be realistic.
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  async function seedQueuedJob(printerId: string, orderId: string, priority = 0): Promise<string> {
    const job = await prisma.printJob.create({
      data: {
        orderId,
        printerId,
        shopId: shop.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.QUEUED,
        priority,
      },
    });
    return job.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);
    tokenService = app.get(TokenService);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Agent Jobs E2E Customer",
        email: `agent-jobs-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/agent-jobs/${randomUUID()}`,
        filename: "agent-jobs-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: { name: `Agent Jobs E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Agent Jobs E2E Counter",
        email: `agent-jobs-e2e-counter-${randomUUID()}@print-automated.dev`,
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

  it("returns 204 quickly when nothing is queued, rather than blocking for the full wait window", async () => {
    const { accessToken } = await registerAndAuthenticate();
    const started = Date.now();

    const res = await request(app.getHttpServer())
      .get("/v1/agents/jobs?wait=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(204);
    // Bounded by the 1s wait plus normal request overhead -- this is
    // the "genuinely blocked the full window" ceiling, not a tight
    // performance assertion.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("returns an already-QUEUED job immediately, without waiting on the Redis signal at all", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const jobId = await seedQueuedJob(printer.id, orderId);

    const started = Date.now();
    const res = await request(app.getHttpServer())
      .get("/v1/agents/jobs?wait=10")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.printerId).toBe(printer.id);
    // The DB-first check should short-circuit well before the 10s
    // window would even matter.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("a blocked long-poll wakes on a real shop-order accept, not just on timeout", async () => {
    // acceptOrder's own printer lookup (shop-orders.service.ts) picks
    // *any* non-disabled printer for the shop with no further
    // ordering -- by this point in the suite, earlier tests' printers
    // are still sitting there non-disabled. Left alone, accept could
    // pick one of THOSE instead of the printer this test is actually
    // polling as, and notify() would signal the wrong agent's Redis
    // key entirely. Disabling them first makes this test's own printer
    // the only eligible one, deterministically.
    await prisma.printer.updateMany({
      where: { shopId: shop.id },
      data: { status: PrinterStatus.DISABLED },
    });

    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const orderId = await seedOrder(OrderStatus.WAITING_FOR_SHOP);

    const pollStarted = Date.now();
    const pollPromise = request(app.getHttpServer())
      .get("/v1/agents/jobs?wait=15")
      .set("Authorization", `Bearer ${accessToken}`);

    // Give the long-poll time to actually reach BRPOP before the
    // notify fires -- otherwise this would only prove the DB-first
    // check works (already covered above), not the wake-up signal.
    await new Promise((resolve) => setTimeout(resolve, 500));

    await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);

    const res = await pollPromise;
    const elapsed = Date.now() - pollStarted;

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.printerId).toBe(printer.id);
    // Woken by the signal, not the 15s timeout -- generous margin for
    // CI/dev-machine scheduling jitter, still far short of 15000ms.
    expect(elapsed).toBeLessThan(8000);
  }, 10_000);

  it("claiming a job racing two concurrent requests: exactly one wins, the other gets 409, and the row ends up CLAIMED exactly once", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const jobId = await seedQueuedJob(printer.id, orderId);

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${accessToken}`),
      request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/claim`)
        .set("Authorization", `Bearer ${accessToken}`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.CLAIMED);
    expect(job.claimedAt).not.toBeNull();
  });

  it("returns 404 when an agent tries to claim a job queued for a different agent's printer", async () => {
    const owner = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(owner.deviceId);
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const jobId = await seedQueuedJob(printer.id, orderId);

    const stranger = await registerAndAuthenticate();

    const res = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/claim`)
      .set("Authorization", `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(404);

    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.QUEUED);
  });

  it("returns 409 when claiming a job that's already CLAIMED", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const orderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const jobId = await seedQueuedJob(printer.id, orderId);

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/claim`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/claim`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("JOB_ALREADY_CLAIMED");
  });

  it("§17/18/18.8: a HIGH-priority job queued AFTER a NORMAL one is still claimed first", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const normalOrderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const normalJobId = await seedQueuedJob(printer.id, normalOrderId, 0);
    // Queued strictly after the NORMAL job (different iteration of the
    // event loop, so createdAt is guaranteed later) -- if priority were
    // ignored, plain FIFO would hand out normalJobId first.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const urgentOrderId = await seedOrder(OrderStatus.QUEUED_FOR_PRINT);
    const urgentJobId = await seedQueuedJob(printer.id, urgentOrderId, 20);

    const res = await request(app.getHttpServer())
      .get("/v1/agents/jobs?wait=1")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(urgentJobId);
    expect(res.body.id).not.toBe(normalJobId);
  });
});
