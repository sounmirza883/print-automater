import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import type { ApiEnv } from "@print-automated/config";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

describe("POST /payments/checkout (6.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

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

    owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Checkout E2E Owner",
        email: `checkout-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    stranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Checkout E2E Stranger",
        email: `checkout-e2e-stranger-${randomUUID()}@print-automated.dev`,
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
        filename: "checkout-e2e-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
        checksum: "irrelevant-for-this-test",
      },
    });

    const shop = await prisma.shop.create({
      data: {
        name: `Checkout E2E Shop ${randomUUID()}`,
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
    await prisma.payment.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } });
    await prisma.pricingRule.deleteMany({ where: { shopId } });
    await prisma.document.deleteMany({ where: { id: readyDocumentId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  async function createUploadedOrder(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId, printConfiguration: CONFIG });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("§23: creates a PENDING payment, returns the provider checkout URL, and moves the order to PAYMENT_PENDING", async () => {
    const orderId = await createUploadedOrder();

    const res = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId });

    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toContain("/v1/payments/mock/checkout");

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.status).toBe("PENDING");
    expect(payment.checkoutUrl).toBe(res.body.checkoutUrl);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe("PAYMENT_PENDING");
  });

  it("§6.4: two sequential checkout calls on one order reuse the same payment record rather than creating a second", async () => {
    const orderId = await createUploadedOrder();

    const first = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId });
    const second = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);

    const payments = await prisma.payment.findMany({ where: { orderId } });
    expect(payments).toHaveLength(1);
  });

  it("§6.4: two genuinely concurrent checkout calls on one order still reuse the same payment record", async () => {
    const orderId = await createUploadedOrder();

    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post("/v1/payments/checkout")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ orderId }),
      request(app.getHttpServer())
        .post("/v1/payments/checkout")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ orderId }),
    ]);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.checkoutUrl).toBe(b.body.checkoutUrl);

    const payments = await prisma.payment.findMany({ where: { orderId } });
    expect(payments).toHaveLength(1);
  });

  it("checkout on someone else's order is refused with 403, and on a nonexistent order with 404", async () => {
    const orderId = await createUploadedOrder();

    const forbidden = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ orderId });
    expect(forbidden.status).toBe(403);

    const missing = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId: randomUUID() });
    expect(missing.status).toBe(404);
  });

  it("checkout on an order that's ineligible for a reason other than an in-flight race is a clean 409, not a confusing lookup failure", async () => {
    // Directly constructed in a status checkout can never legally leave
    // (same "seed an arbitrary status" technique 5.4's own matrix test
    // uses) -- crucially, one with no payment row at all, so the
    // catch-block's "was this actually a race?" check has nothing to
    // find and must correctly re-throw instead of fabricating success.
    const orderId = await createUploadedOrder();
    await prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: "PAID" },
    });

    const res = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ orderId });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");
  });

  it("an unauthenticated request is rejected before touching any of this", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .send({ orderId: randomUUID() });
    expect(res.status).toBe(401);
  });
});
