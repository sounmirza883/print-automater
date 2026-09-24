import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  PrintJobStatus,
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

function generateAgentKeypair(): { publicKeyBase64Url: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { publicKeyBase64Url: jwk.x, privateKey };
}

function signNonce(privateKey: KeyObject, nonce: string): string {
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64url");
}

/** 18.15: the reviewer's flap sequence, driven through the real agent
 * status endpoint. Aggregation used to regress the order to ASSIGNED /
 * QUEUED_FOR_PRINT when one job PRINTED while a sibling was unfinished, then
 * re-enter PRINTING (a second PRINT_STARTED notification). */
describe("Multi-job order status does not flap (18.15, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;

  let customer: { id: string };
  let documentId: string;
  let shop: { id: string };
  let counter: { id: string; role: UserRole };

  const agentTokens: string[] = [];
  const printerIds: string[] = [];
  const printerAgentIds: string[] = [];
  const orderIds: string[] = [];

  async function registerAgent(): Promise<{ deviceId: string; accessToken: string }> {
    const { code } = await pairingCodeService.issue(shop.id, counter.id);
    const { publicKeyBase64Url, privateKey } = generateAgentKeypair();
    const deviceId = randomUUID();

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
        name: "Concurrent Reports E2E Customer",
        email: `concurrent-reports-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/flap/${randomUUID()}`,
        filename: "concurrent-reports-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 5,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: {
        name: `Concurrent Reports E2E Shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
        multiItemEnabled: true,
      },
    });
    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Concurrent Reports E2E Counter",
        email: `concurrent-reports-e2e-counter-${randomUUID()}@print-automated.dev`,
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

    // Three genuinely distinct agent devices, each with its own
    // printer -- registered ONCE (not once per iteration, which would
    // be both slow and irrelevant to what this test is actually
    // proving) and reused across all 20 iterations below.
    for (let i = 0; i < 3; i += 1) {
      const { deviceId, accessToken } = await registerAgent();
      const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
      printerAgentIds.push(agent.id);
      const printer = await prisma.printer.create({
        data: {
          shopId: shop.id,
          agentId: agent.id,
          name: `Concurrent Reports Printer ${i + 1}`,
          status: PrinterStatus.ONLINE,
          capabilities: { color: false, duplex: false, a4: true, a3: false },
        },
      });
      printerIds.push(printer.id);
      agentTokens.push(accessToken);
    }
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: printerAgentIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: customer.id } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

  async function seedThreeJobOrder(): Promise<{ orderId: string; jobIds: string[] }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-FLAP-${randomUUID()}`,
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
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        // Already ASSIGNED (all three jobs CLAIMED) -- this test's own
        // scope is the concurrent PRINTED reports themselves, not the
        // earlier accept/claim legs already covered elsewhere.
        orderStatus: OrderStatus.ASSIGNED,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);

    const jobIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId,
          printConfiguration: order.printConfiguration!,
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: i,
        },
      });
      const job = await prisma.printJob.create({
        data: {
          orderId: order.id,
          shopId: shop.id,
          orderItemId: item.id,
          printerId: printerIds[i]!,
          idempotencyToken: `${item.id}:1`,
          status: PrintJobStatus.CLAIMED,
          claimedAt: new Date(),
        },
      });
      jobIds.push(job.id);
    }
    return { orderId: order.id, jobIds };
  }

  it("PRINTING -> A PRINTED -> B PRINTING keeps the order PRINTING with exactly one PRINT_STARTED pair", async () => {
    const { orderId, jobIds } = await seedThreeJobOrder();
    // Only two jobs matter; the third is cancelled out of the set.
    await prisma.printJob.update({
      where: { id: jobIds[2]! },
      data: { status: PrintJobStatus.CANCELLED },
    });
    const [jobA, jobB] = [jobIds[0]!, jobIds[1]!];
    const report = (jobId: string, agentIndex: number, status: string) =>
      request(app.getHttpServer())
        .post(`/v1/agents/jobs/${jobId}/status`)
        .set("Authorization", `Bearer ${agentTokens[agentIndex]}`)
        .set("Idempotency-Key", `${jobId}:${status}`)
        .send({ status });
    const orderStatus = async () =>
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus;

    expect((await report(jobA, 0, "PRINTING")).status).toBeLessThan(300);
    expect(await orderStatus()).toBe(OrderStatus.PRINTING);

    expect((await report(jobA, 0, "PRINTED")).status).toBeLessThan(300);
    expect(await orderStatus()).toBe(OrderStatus.PRINTING);

    expect((await report(jobB, 1, "PRINTING")).status).toBeLessThan(300);
    expect(await orderStatus()).toBe(OrderStatus.PRINTING);

    const started = await prisma.notification.findMany({
      where: { orderId, type: "PRINT_STARTED" },
    });
    expect(started.filter((n) => n.channel === "APP")).toHaveLength(1);
    expect(started.filter((n) => n.channel === "EMAIL")).toHaveLength(1);

    expect((await report(jobB, 1, "PRINTED")).status).toBeLessThan(300);
    expect(await orderStatus()).toBe(OrderStatus.PRINTED);
  }, 60_000);
});
