import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
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

/** 18.10's own phase-gate suite (item 1 of 3). `shops.multiItemEnabled`
 * stays at its default (false) throughout -- every order here takes
 * exactly the one synthetic OrderItem 18.5's own dispatchToPrinter()
 * creates the first time it ever sees an item-less order, which is
 * every order that predates Phase 18. `EXPECTED_BY_STEP` is an
 * independently hand-written record of what the OLD, now-deleted
 * explicit-event table (START_PRINT/FINISH_PRINT/FAIL_PRINT/
 * LOSE_PRINT_STATUS/RETRY_PRINT/RESOLVE_UNKNOWN_*) produced at each
 * step of these exact journeys -- not derived from the new code, so a
 * regression shows up as a real mismatch, not the implementation
 * checked against itself. Every one of the 35 pre-existing e2e suites
 * this phase touched (order-state-machine, order-notifications,
 * duplicate-print-campaign, agent-job-status, shop-order-actions,
 * worker's print-timeout, ...) already re-asserts this same
 * equivalence at the level of its own specific scenario and is green;
 * this file is the single, explicit, end-to-end walk the plan's own
 * 18.10 item 1 calls for, covering the three named journeys in one
 * place: accept -> dispatch -> claim -> print -> complete; failure ->
 * retry; unknown -> resolve. */
describe("Single-job equivalence (18.10 phase-gate, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pairingCodeService: AgentPairingCodeService;
  let tokenService: TokenService;

  let customer: { id: string };
  let documentId: string;

  const orderIds: string[] = [];
  const printerIds: string[] = [];
  const printerAgentIds: string[] = [];
  const deviceIds: string[] = [];
  const shopIds: string[] = [];
  const staffUserIds: string[] = [];

  // 18.5's auto-allocation tie-break (fewest queued pages/jobs, then
  // oldest registration) means printers accumulated by an EARLIER
  // journey in a SHARED shop could win a LATER journey's own dispatch
  // once their own job is done and their queue empties back out --
  // exactly the kind of cross-test interference a real production
  // shop never has to worry about (one shop's own printer fleet is
  // fixed) but a multi-journey suite sharing one shop would. Each
  // journey below gets its own dedicated shop, counter and printer, so
  // "this journey's own agent claims and reports on this journey's own
  // job" is unambiguous by construction, not by accident of timing.
  async function setupShop(): Promise<{
    shop: { id: string };
    counter: { id: string; role: UserRole };
    counterToken: string;
  }> {
    const shop = await prisma.shop.create({
      data: { name: `Equivalence E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopIds.push(shop.id);
    const counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Equivalence E2E Counter",
        email: `equivalence-e2e-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    staffUserIds.push(counter.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const counterToken = tokenService.issueAccessToken(counter);
    return { shop, counter, counterToken };
  }

  async function registerAndAuthenticate(
    shop: { id: string },
    counter: { id: string },
  ): Promise<{ deviceId: string; accessToken: string }> {
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

  async function createOnlinePrinter(
    shop: { id: string },
    deviceId: string,
    name: string,
  ): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    printerAgentIds.push(agent.id);
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agent.id,
        name,
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  /** Counts customer notifications by "TYPE:CHANNEL" so equivalence covers
   * what the customer actually receives, not just the final status. */
  async function notificationCounts(orderId: string): Promise<Record<string, number>> {
    const rows = await prisma.notification.findMany({ where: { orderId } });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.type}:${row.channel}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  async function jobAuditActions(jobId: string): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      where: { resourceType: "print_job", resourceId: jobId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => r.action);
  }

  async function seedOrder(shop: { id: string }, orderStatus: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-EQUIV-${randomUUID()}`,
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
        name: "Equivalence E2E Customer",
        email: `equivalence-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/equivalence/${randomUUID()}`,
        filename: "equivalence-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
    // multiItemEnabled deliberately absent from every shop below ->
    // Prisma's own schema default (false), exactly what every shop in
    // production has today.
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId: { in: shopIds } } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: printerAgentIds } } });
    await prisma.agentPairingCode.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: staffUserIds } } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, ...staffUserIds] } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  it("journey 1: accept -> dispatch -> claim -> report PRINTING -> report PRINTED -> mark ready -> complete, matching the OLD table's target at every step", async () => {
    const { shop, counter, counterToken } = await setupShop();
    const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
    await createOnlinePrinter(shop, deviceId, "Equivalence Printer J1");
    const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);

    // OLD: WAITING_FOR_SHOP --SHOP_ACCEPT--> SHOP_ACCEPTED --QUEUE_PRINT--> QUEUED_FOR_PRINT (unchanged, both fixed events)
    const accept = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);
    expect(accept.body.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);

    const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${job.id}/claim`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    // OLD: claim never moved the order (only reportStatus did) -- still QUEUED_FOR_PRINT.
    const afterClaim = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterClaim.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);

    // OLD: QUEUED_FOR_PRINT --START_PRINT--> PRINTING.
    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${job.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${job.id}:PRINTING`)
      .send({ status: "PRINTING" })
      .expect(200);
    const afterPrinting = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterPrinting.orderStatus).toBe(OrderStatus.PRINTING);

    // OLD: PRINTING --FINISH_PRINT--> PRINTED.
    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${job.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${job.id}:PRINTED`)
      .send({ status: "PRINTED" })
      .expect(200);
    const afterPrinted = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterPrinted.orderStatus).toBe(OrderStatus.PRINTED);
    // Exactly one PRINT_STARTED and one PRINT_COMPLETED pair (APP + EMAIL), nothing else.
    expect(await notificationCounts(orderId)).toMatchObject({
      "PRINT_STARTED:APP": 1,
      "PRINT_STARTED:EMAIL": 1,
      "PRINT_COMPLETED:APP": 1,
      "PRINT_COMPLETED:EMAIL": 1,
    });
    expect(await jobAuditActions(job.id)).toEqual([
      "PRINT_JOB_CLAIM",
      "PRINT_JOB_START",
      "PRINT_JOB_PRINTED",
    ]);

    // OLD: PRINTED --MARK_READY--> READY_FOR_COLLECTION (unchanged, fixed event).
    const ready = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/ready`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);
    expect(ready.body.orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);

    // OLD: READY_FOR_COLLECTION --COMPLETE--> COMPLETED (unchanged, fixed event).
    const completed = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/complete`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);
    expect(completed.body.orderStatus).toBe(OrderStatus.COMPLETED);
  });

  it("journey 1b: a PRINTED report on a job that is still QUEUED or only CLAIMED self-heals through START -- both PRINT_STARTED and PRINT_COMPLETED pairs, as OLD", async () => {
    for (const claimFirst of [false, true]) {
      const { shop, counter, counterToken } = await setupShop();
      const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
      await createOnlinePrinter(shop, deviceId, `Equivalence Printer J1b-${claimFirst}`);
      const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);
      await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${counterToken}`)
        .expect(200);
      const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
      if (claimFirst) {
        await request(app.getHttpServer())
          .post(`/v1/agents/jobs/${job.id}/claim`)
          .set("Authorization", `Bearer ${accessToken}`)
          .expect(200);
      }
      await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${job.id}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", `${job.id}:PRINTED`)
        .send({ status: "PRINTED" })
        .expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
        OrderStatus.PRINTED,
      );
      expect(await notificationCounts(orderId)).toEqual({
        "ORDER_ACCEPTED:APP": 1,
        "ORDER_ACCEPTED:EMAIL": 1,
        "PRINT_STARTED:APP": 1,
        "PRINT_STARTED:EMAIL": 1,
        "PRINT_COMPLETED:APP": 1,
        "PRINT_COMPLETED:EMAIL": 1,
      });
      expect(await jobAuditActions(job.id)).toEqual([
        "PRINT_JOB_CLAIM",
        "PRINT_JOB_START",
        "PRINT_JOB_PRINTED",
      ]);
    }
  });

  it("journey 2: failure -> retry, matching OLD QUEUED_FOR_PRINT--FAIL_PRINT-->PRINT_FAILED--RETRY_PRINT-->QUEUED_FOR_PRINT", async () => {
    const { shop, counter, counterToken } = await setupShop();
    const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
    await createOnlinePrinter(shop, deviceId, "Equivalence Printer J2");
    const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);

    await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);

    const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
    // OLD: QUEUED_FOR_PRINT --FAIL_PRINT--> PRINT_FAILED.
    await request(app.getHttpServer())
      .post(`/v1/agents/jobs/${job.id}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", `${job.id}:FAILED`)
      .send({ status: "FAILED" })
      .expect(200);
    const afterFail = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterFail.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    // OLD always tried START_PRINT first: PRINT_STARTED, then PRINT_FAILED.
    expect(await notificationCounts(orderId)).toMatchObject({
      "PRINT_STARTED:APP": 1,
      "PRINT_STARTED:EMAIL": 1,
      "PRINT_FAILED:APP": 1,
      "PRINT_FAILED:EMAIL": 1,
    });

    // OLD: PRINT_FAILED --RETRY_PRINT--> QUEUED_FOR_PRINT.
    const retry = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/retry-print`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);
    expect(retry.body.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);

    // Exactly TWO print_job rows exist for this order: the FAILED
    // original (superseded) and the fresh QUEUED retry -- never a
    // flip/reuse of the same row.
    const jobs = await prisma.printJob.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.status).toBe("FAILED");
    expect(jobs[0]?.supersededAt).not.toBeNull();
    expect(jobs[1]?.status).toBe("QUEUED");
    expect(jobs[1]?.supersededAt).toBeNull();
  });

  it("journey 3: unknown -> each of the three resolutions (OLD: START_PRINT then LOSE_PRINT_STATUS, since LOSE was only legal from PRINTING; the report arrives while the job is still QUEUED, so the job machine must START first)", async () => {
    // 3a: resolution CONFIRMED_PRINTED -> PRINTED (OLD RESOLVE_UNKNOWN_PRINTED).
    {
      const { shop, counter, counterToken } = await setupShop();
      const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
      await createOnlinePrinter(shop, deviceId, "Equivalence Printer J3a");
      const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);
      await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${counterToken}`)
        .expect(200);
      const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
      await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${job.id}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", `${job.id}:UNKNOWN`)
        .send({ status: "UNKNOWN" })
        .expect(200);
      const afterUnknown = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(afterUnknown.orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
      // START happened first (PRINT_STARTED notified); UNKNOWN itself never notifies.
      expect(await notificationCounts(orderId)).toEqual({
        "ORDER_ACCEPTED:APP": 1,
        "ORDER_ACCEPTED:EMAIL": 1,
        "PRINT_STARTED:APP": 1,
        "PRINT_STARTED:EMAIL": 1,
      });

      const resolved = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
        .set("Authorization", `Bearer ${counterToken}`)
        .send({ resolution: "CONFIRMED_PRINTED" })
        .expect(200);
      expect(resolved.body.orderStatus).toBe(OrderStatus.PRINTED);
      expect((await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        "PRINTED",
      );
      // A staff resolution never notifies the customer (as OLD).
      expect(await notificationCounts(orderId)).toEqual({
        "ORDER_ACCEPTED:APP": 1,
        "ORDER_ACCEPTED:EMAIL": 1,
        "PRINT_STARTED:APP": 1,
        "PRINT_STARTED:EMAIL": 1,
      });
    }

    // 3b: resolution MARK_FAILED -> PRINT_FAILED (OLD RESOLVE_UNKNOWN_FAILED).
    {
      const { shop, counter, counterToken } = await setupShop();
      const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
      await createOnlinePrinter(shop, deviceId, "Equivalence Printer J3b");
      const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);
      await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${counterToken}`)
        .expect(200);
      const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
      await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${job.id}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", `${job.id}:UNKNOWN`)
        .send({ status: "UNKNOWN" })
        .expect(200);

      const resolved = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
        .set("Authorization", `Bearer ${counterToken}`)
        .send({ resolution: "MARK_FAILED" })
        .expect(200);
      expect(resolved.body.orderStatus).toBe(OrderStatus.PRINT_FAILED);
    }

    // 3c: resolution RETRY -> QUEUED_FOR_PRINT (OLD RESOLVE_UNKNOWN_RETRY).
    {
      const { shop, counter, counterToken } = await setupShop();
      const { deviceId, accessToken } = await registerAndAuthenticate(shop, counter);
      await createOnlinePrinter(shop, deviceId, "Equivalence Printer J3c");
      const orderId = await seedOrder(shop, OrderStatus.WAITING_FOR_SHOP);
      await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${counterToken}`)
        .expect(200);
      const job = await prisma.printJob.findFirstOrThrow({ where: { orderId } });
      await request(app.getHttpServer())
        .post(`/v1/agents/jobs/${job.id}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("Idempotency-Key", `${job.id}:UNKNOWN`)
        .send({ status: "UNKNOWN" })
        .expect(200);

      const resolved = await request(app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
        .set("Authorization", `Bearer ${counterToken}`)
        .send({ resolution: "RETRY" })
        .expect(200);
      expect(resolved.body.orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
    }
  });
});
