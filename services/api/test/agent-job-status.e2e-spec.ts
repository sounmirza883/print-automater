import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
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
import { branchIdOf } from "./helpers/branches.js";

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

/** §9.12/§92, e2e: POST /agents/jobs/:id/status against real Postgres,
 * proving both halves at once -- the print_job row update and the
 * order's own state-machine transition it drives, plus the real
 * IdempotencyInterceptor (5.3) guarding it exactly like order
 * creation/acceptance already are. */
describe("Agent job status reporting (9.12, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shop: { id: string };
  let counter: { id: string };

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
        branchId: await branchIdOf(prisma, shop.id),
        agentId: agent.id,
        name: `Agent Status E2E Printer ${randomUUID()}`,
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  async function seedJob(
    printerId: string,
    orderStatus: OrderStatus,
    jobStatus: PrintJobStatus,
  ): Promise<{ jobId: string; orderId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-AGENTSTATUS-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        orderStatus,
      },
    });
    orderIds.push(order.id);

    const job = await prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId,
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        idempotencyToken: randomUUID(),
        status: jobStatus,
        claimedAt: new Date(),
      },
    });
    return { jobId: job.id, orderId: order.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    pairingCodeService = app.get(AgentPairingCodeService);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Agent Status E2E Customer",
        email: `agent-status-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/agent-status/${randomUUID()}`,
        filename: "agent-status-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: {
        name: `Agent Status E2E Shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    const counterUser = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Agent Status E2E Counter",
        email: `agent-status-e2e-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counterUser.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counter = counterUser;
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
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

  it("PRINTING moves the order QUEUED_FOR_PRINT -> PRINTING and the job to PRINTING", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.QUEUED_FOR_PRINT,
      PrintJobStatus.CLAIMED,
    );

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${jobId}:PRINTING`)
      .send({ status: "PRINTING" })
      .expect(200);

    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.PRINTING);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTING);
  });

  it("PRINTED from PRINTING moves the order to PRINTED", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.PRINTING,
      PrintJobStatus.PRINTING,
    );

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${jobId}:PRINTED`)
      .send({ status: "PRINTED", osJobId: "42" })
      .expect(200);

    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(PrintJobStatus.PRINTED);
    expect(job.osJobId).toBe("42");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTED);
  });

  it("a PRINTED report arriving with the earlier PRINTING report lost still resolves the order to PRINTED -- auto-chains START_PRINT first", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.QUEUED_FOR_PRINT,
      PrintJobStatus.CLAIMED,
    );

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${jobId}:PRINTED`)
      .send({ status: "PRINTED" })
      .expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTED);
  });

  it("FAILED moves the order to PRINT_FAILED", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.PRINTING,
      PrintJobStatus.PRINTING,
    );

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${jobId}:FAILED`)
      .send({ status: "FAILED" })
      .expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_FAILED);
  });

  it("UNKNOWN moves the order to PRINT_STATUS_UNKNOWN", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.PRINTING,
      PrintJobStatus.PRINTING,
    );

    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${jobId}:UNKNOWN`)
      .send({ status: "UNKNOWN" })
      .expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
  });

  it("§9.12's own Done-when: a report replayed under the same Idempotency-Key produces exactly one transition, not two", async () => {
    const { deviceId, accessToken } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId, orderId } = await seedJob(
      printer.id,
      OrderStatus.QUEUED_FOR_PRINT,
      PrintJobStatus.CLAIMED,
    );
    const idempotencyKey = `${jobId}:PRINTING`;

    for (let attempt = 0; attempt < 3; attempt++) {
      await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", idempotencyKey)
        .send({ status: "PRINTING" })
        .expect(200);
    }

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.PRINTING);

    // 18.1/18.2: STARTED_PRINT no longer exists as an order-machine
    // event -- the job-level PRINT_JOB_START event (PrintJobStateMachine)
    // plus the order-level ORDER_SYNC_JOBS follow-up are what replace it.
    const jobTransitions = await prisma.auditLog.count({
      where: { resourceType: "print_job", resourceId: jobId, action: "PRINT_JOB_START" },
    });
    expect(jobTransitions).toBe(1);
    const orderSyncs = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SYNC_JOBS" },
    });
    expect(orderSyncs).toBe(1);
  });

  it("returns 404 for a job belonging to a different agent's printer", async () => {
    const owner = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(owner.deviceId);
    const { jobId } = await seedJob(printer.id, OrderStatus.PRINTING, PrintJobStatus.PRINTING);

    const stranger = await registerAndAuthenticate();

    const res = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ status: "PRINTED" });

    expect(res.status).toBe(404);
  });

  it("returns 401 with no agent token", async () => {
    const { deviceId } = await registerAndAuthenticate();
    const printer = await createPrinterForAgent(deviceId);
    const { jobId } = await seedJob(printer.id, OrderStatus.PRINTING, PrintJobStatus.PRINTING);

    const res = await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${jobId}/status`)
      .send({ status: "PRINTED" });

    expect(res.status).toBe(401);
  });
});
