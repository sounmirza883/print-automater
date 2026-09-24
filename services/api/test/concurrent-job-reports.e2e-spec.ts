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

/** 18.10's own phase-gate suite (item 3 of 3) -- the concurrency test.
 * 3 jobs on one multi-item order, 3 PARALLEL agent "PRINTED" status
 * reports (three genuinely different agent devices/printers, each
 * reporting its own job), run 20 CONSECUTIVE iterations in the test
 * itself (a loop, not 20 separate `it()` blocks -- deadlocks are
 * probabilistic, a single pass proves nothing, per the plan doc's own
 * risk mitigation). Each iteration asserts:
 *   1. exactly one order transition to PRINTED (derived, via
 *      SYNC_JOBS) -- not zero, not more than one;
 *   2. exactly one APP and one EMAIL notification row of type
 *      PRINT_COMPLETED for that order -- the flapping-risk guard, made
 *      concrete against a real database under real concurrency, not
 *      just the pure aggregateOrderStatus() unit/purity tests;
 *   3. zero Postgres 40P01 (deadlock_detected) errors -- the
 *      structural "orders row locked first, job rows in ascending id
 *      order, every writer" guarantee, proven under load rather than
 *      just asserted in a code comment. */
describe("Concurrent job status reports (18.10 concurrency gate, e2e)", () => {
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
  const deadlockErrors: string[] = [];

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
        storageKey: `test/concurrent-reports/${randomUUID()}`,
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
        publicOrderNumber: `TEST-CONCURRENT-${randomUUID()}`,
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

  it("20 consecutive iterations: exactly one PRINTED transition, exactly one APP + one EMAIL notification, zero deadlocks -- every single time", async () => {
    const ITERATIONS = 20;
    const perIterationResults: Array<{
      finalStatus: string;
      appCount: number;
      emailCount: number;
    }> = [];

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const { orderId, jobIds } = await seedThreeJobOrder();

      const responses = await Promise.all(
        jobIds.map((jobId, i) =>
          request(app.getHttpServer())
            .post(`/v1/agents/jobs/${jobId}/status`)
            .set("Authorization", `Bearer ${agentTokens[i]}`)
            .set("Idempotency-Key", `${jobId}:PRINTED`)
            .send({ status: "PRINTED" })
            .then((res) => res)
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              if (message.includes("40P01") || message.toLowerCase().includes("deadlock")) {
                deadlockErrors.push(`iteration ${iteration}: ${message}`);
              }
              throw err;
            }),
        ),
      );

      for (const res of responses) {
        if (res.status >= 500) {
          const bodyText = JSON.stringify(res.body);
          if (bodyText.includes("40P01") || bodyText.toLowerCase().includes("deadlock")) {
            deadlockErrors.push(`iteration ${iteration}: ${bodyText}`);
          }
        }
        expect(res.status).toBeLessThan(500);
      }

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      const jobs = await prisma.printJob.findMany({ where: { orderId } });
      expect(jobs.every((j) => j.status === PrintJobStatus.PRINTED)).toBe(true);

      const notifications = await prisma.notification.findMany({
        where: { orderId, type: "PRINT_COMPLETED" },
      });
      const appCount = notifications.filter((n) => n.channel === "APP").length;
      const emailCount = notifications.filter((n) => n.channel === "EMAIL").length;

      perIterationResults.push({ finalStatus: order.orderStatus, appCount, emailCount });

      expect(order.orderStatus).toBe(OrderStatus.PRINTED);
      expect(appCount).toBe(1);
      expect(emailCount).toBe(1);
    }

    // Explicit, whole-run assertions -- not just "the loop didn't
    // throw": every one of the 20 iterations individually landed on
    // exactly PRINTED with exactly one notification pair, and the
    // deadlock tracker (populated from BOTH a caught request error and
    // a >=500 response body, whichever form a real 40P01 would surface
    // as) stayed empty across all 20.
    expect(perIterationResults).toHaveLength(ITERATIONS);
    expect(perIterationResults.every((r) => r.finalStatus === OrderStatus.PRINTED)).toBe(true);
    expect(perIterationResults.every((r) => r.appCount === 1)).toBe(true);
    expect(perIterationResults.every((r) => r.emailCount === 1)).toBe(true);
    expect(deadlockErrors).toEqual([]);
  }, 120_000);
});
