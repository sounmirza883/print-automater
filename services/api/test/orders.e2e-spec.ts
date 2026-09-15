import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, ShopStatus, UserRole } from "@prisma/client";
import { OrderEvent, OrderStateMachine, PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 2,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

describe("Orders API (5.5, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let stateMachine: OrderStateMachine;

  let owner: { id: string; role: UserRole };
  let stranger: { id: string; role: UserRole };
  let ownerToken: string;
  let strangerToken: string;

  let readyDocumentId: string;
  let shopId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    stateMachine = app.get(OrderStateMachine);

    owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Orders E2E Owner",
        email: `orders-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    stranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Orders E2E Stranger",
        email: `orders-e2e-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerToken = tokenService.issueAccessToken(owner);
    strangerToken = tokenService.issueAccessToken(stranger);

    readyDocumentId = randomUUID();
    await prisma.document.create({
      data: {
        id: readyDocumentId,
        ownerUserId: owner.id,
        storageKey: `documents/${readyDocumentId}`,
        filename: "orders-e2e-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 10,
        checksum: "irrelevant-for-this-test",
      },
    });

    const shop = await prisma.shop.create({
      data: {
        name: `Orders E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopId = shop.id;
    await prisma.pricingRule.create({
      data: {
        shopId,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.pricingRule.deleteMany({ where: { shopId } });
    await prisma.document.deleteMany({ where: { id: readyDocumentId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  it("§20: creates an order with a server-computed total, ignoring a client-supplied total; the order starts UPLOADED with payment PENDING", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        documentId: readyDocumentId,
        shopId,
        printConfiguration: CONFIG,
        total: 1,
        totalMinor: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.publicOrderNumber).toMatch(/^PA-\d{8}-\d{6}$/);
    expect(res.body.documentId).toBe(readyDocumentId);
    expect(res.body.shopId).toBe(shopId);
    expect(res.body.orderStatus).toBe("UPLOADED");
    expect(res.body.paymentStatus).toBe("PENDING");
    // 10 pages x 2 copies x Rs 10.00/page = Rs 200.00 (20000).
    expect(res.body.pricingSnapshot.quote.totalMinor).toBe(
      20000 + res.body.pricingSnapshot.quote.platformFeeMinor,
    );
    expect(res.body.pricingSnapshot.pricingRuleVersion).toBe(1);
  });

  it("§20: changing the shop's pricing rule after order creation leaves the existing order's total untouched", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(created.status).toBe(201);
    const originalTotal = created.body.pricingSnapshot.quote.totalMinor;

    // A steep price change -- if the order ever re-read the shop's
    // *current* rule instead of its own snapshot, this would be
    // impossible to miss.
    await prisma.pricingRule.create({
      data: {
        shopId,
        version: 2,
        currency: "PKR",
        pricePerPageMinor: 999_999,
        colorSurchargePerPageMinor: 999_999,
        otherCharges: [],
        minimumChargeMinor: 999_999,
      },
    });

    const reread = await request(app.getHttpServer())
      .get(`/v1/orders/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reread.status).toBe(200);
    expect(reread.body.pricingSnapshot.quote.totalMinor).toBe(originalTotal);
    expect(reread.body.pricingSnapshot.pricingRuleVersion).toBe(1);

    // A fresh order, quoted after the price change, is priced under
    // the new rule -- proving the old order's stability isn't just
    // because the price change never took effect at all.
    const afterChange = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(afterChange.status).toBe(201);
    expect(afterChange.body.pricingSnapshot.pricingRuleVersion).toBe(2);
    expect(afterChange.body.pricingSnapshot.quote.totalMinor).not.toBe(originalTotal);
  });

  it("§92/5.3: POST /orders is idempotent under a repeated Idempotency-Key -- a retried request replays the same order instead of minting a second one", async () => {
    const key = randomUUID();
    const body = { documentId: readyDocumentId, shopId, printConfiguration: CONFIG };

    const first = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", key)
      .send(body);
    expect(first.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.publicOrderNumber).toBe(first.body.publicOrderNumber);

    const count = await prisma.order.count({ where: { id: first.body.id } });
    expect(count).toBe(1);
  });

  it("lists only the requesting customer's own orders", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(created.status).toBe(201);

    const ownerList = await request(app.getHttpServer())
      .get("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.map((order: { id: string }) => order.id)).toContain(created.body.id);

    const strangerList = await request(app.getHttpServer())
      .get("/v1/orders")
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerList.status).toBe(200);
    expect(strangerList.body.map((order: { id: string }) => order.id)).not.toContain(
      created.body.id,
    );
  });

  it("GET /orders/:id: 404 for a nonexistent order, 403 for someone else's order", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(created.status).toBe(201);

    const missing = await request(app.getHttpServer())
      .get(`/v1/orders/${randomUUID()}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(missing.status).toBe(404);

    const forbidden = await request(app.getHttpServer())
      .get(`/v1/orders/${created.body.id}`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(forbidden.status).toBe(403);
  });

  it("§79: cancel is refused on a freshly created (UPLOADED) order, succeeds once the order reaches PAYMENT_PENDING, and is scoped to the owner", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;

    const tooEarly = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(tooEarly.status).toBe(409);

    await stateMachine.transition(orderId, OrderEvent.REQUEST_PAYMENT, { id: null });

    const strangerAttempt = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(strangerAttempt.status).toBe(403);

    const cancelled = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.orderStatus).toBe("CANCELLED");
  });

  it("an unauthenticated request is rejected before touching any of this", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders")
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(res.status).toBe(401);
  });
});
