import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import type Redis from "ioredis";
import { DocumentStatus, OrderStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, REDIS_CLIENT } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { TokenService } from "../src/auth/token.service.js";

describe("Rate limiting (e2e)", () => {
  let app: NestExpressApplication;
  let redis: Redis;
  let prisma: PrismaService;
  let tokenService: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    redis = app.get<Redis>(REDIS_CLIENT);
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("§85: login is limited to 5 per 15min per IP+email -- the 6th attempt returns 429 with Retry-After", async () => {
    const email = `rate-limit-e2e-${randomUUID()}@print-automated.dev`;
    // Fresh bucket: this email has never been used before, so there's
    // nothing to flush, but being explicit documents the assumption.
    const keys = await redis.keys(`ratelimit:AuthController:login:*:${email}`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email, password: "whatever-wrong-password" });
      // Each of the first 5 is allowed through to the handler (which
      // rejects for bad credentials) -- 401, never 429.
      expect(res.status).toBe(401);
    }

    const sixth = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "whatever-wrong-password" });

    expect(sixth.status).toBe(429);
    expect(sixth.headers["retry-after"]).toBeDefined();
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
    expect(sixth.body).toMatchObject({ error_code: "RATE_LIMITED", retryable: true });
  });

  it("§85: a different email from the same IP is a separate bucket, unaffected by the above", async () => {
    const email = `rate-limit-e2e-other-${randomUUID()}@print-automated.dev`;
    const res = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email, password: "irrelevant" });
    expect(res.status).toBe(401); // not 429 -- distinct bucket
  });

  it("§85: signup is limited to 3 per hour per IP -- the 4th attempt returns 429", async () => {
    // Signup's own bucket is keyed by IP alone (no per-user dimension
    // the way login's IP+email key gives every test its own fresh
    // bucket) -- every /auth/register call from this same test-runner
    // IP across the whole session shares it, and the 1hr window means
    // it doesn't self-clear between test runs. Same fix the login test
    // above already applies for the same reason.
    const keys = await redis.keys("ratelimit:AuthController:register:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/register")
        .send({
          name: "Rate Limit Signup",
          email: `rate-limit-signup-${randomUUID()}@print-automated.dev`,
          password: "a-genuinely-long-enough-password-1",
        });
      expect(res.status).not.toBe(429);
    }

    const fourth = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({
        name: "Rate Limit Signup",
        email: `rate-limit-signup-${randomUUID()}@print-automated.dev`,
        password: "a-genuinely-long-enough-password-1",
      });
    expect(fourth.status).toBe(429);
    expect(fourth.headers["retry-after"]).toBeDefined();
  });

  it("§85: document upload (POST /documents) is limited to 20/hr per user -- the 21st attempt returns 429", async () => {
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Rate Limit Upload Customer",
        email: `rate-limit-upload-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const token = tokenService.issueAccessToken(customer);
    const body = { filename: "test.pdf", mimeType: "application/pdf", sizeBytes: 1024 };

    for (let attempt = 1; attempt <= 20; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/documents")
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(201);
    }

    const twentyFirst = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.headers["retry-after"]).toBeDefined();

    await prisma.document.deleteMany({ where: { ownerUserId: customer.id } });
    await prisma.user.delete({ where: { id: customer.id } });
  }, 30_000);

  it("§85: checkout is limited to 10/hr per user -- the 11th attempt returns 429", async () => {
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Rate Limit Checkout Customer",
        email: `rate-limit-checkout-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const token = tokenService.issueAccessToken(customer);
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/rate-limit-checkout/${randomUUID()}`,
        filename: "rate-limit-checkout.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    const shop = await prisma.shop.create({
      data: {
        name: `Rate Limit Checkout Shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-RATELIMIT-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        documentId: document.id,
        printConfiguration: {},
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        // REQUEST_PAYMENT (checkout's own first transition) is only
        // legal from UPLOADED, not the default DRAFT.
        orderStatus: OrderStatus.UPLOADED,
      },
    });

    // Repeated checkout calls on the SAME order idempotently reuse the
    // same payment (6.4's own Done-when) -- the rate limiter still
    // counts each attempt regardless, since RateLimitGuard runs before
    // any of that service logic.
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/payments/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send({ orderId: order.id });
      expect(res.status).toBe(201);
    }

    const eleventh = await request(app.getHttpServer())
      .post("/v1/payments/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId: order.id });
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers["retry-after"]).toBeDefined();

    await prisma.payment.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.document.delete({ where: { id: document.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.delete({ where: { id: customer.id } });
  }, 30_000);

  it("§85: agent auth (challenge) is limited to 10/min per device -- the 11th attempt returns 429 (register/authenticate share the identical mechanism, keyed by the same deviceId, just a separate bucket per route)", async () => {
    const deviceId = randomUUID();

    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await request(app.getHttpServer())
        .post("/v1/agents/authenticate/challenge")
        .send({ deviceId });
      expect(res.status).not.toBe(429);
    }

    const eleventh = await request(app.getHttpServer())
      .post("/v1/agents/authenticate/challenge")
      .send({ deviceId });
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers["retry-after"]).toBeDefined();
  });
});
