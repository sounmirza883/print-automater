import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import type Redis from "ioredis";
import { UserRole } from "@prisma/client";
import { PrismaService, REDIS_CLIENT } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

function validBody(overrides: { ownerEmail?: string; shopName?: string } = {}) {
  return {
    shop: {
      name: overrides.shopName ?? `Self-Service Print Shop ${randomUUID()}`,
      address: "99 Signup Ave, Lahore",
      phone: "+924200099999",
      capabilities: { color: true, duplex: false, a4: true, a3: false },
    },
    owner: {
      name: "Self Service Owner",
      email: overrides.ownerEmail ?? `shop-registration-e2e-${randomUUID()}@print-automated.dev`,
      password: "CorrectHorseBatteryStaple9",
      phone: "+923001112222",
    },
    pricing: {
      currency: "PKR",
      pricePerPageMinor: 800,
      colorSurchargePerPageMinor: 300,
      minimumChargeMinor: 3000,
    },
  };
}

describe("Shop registration (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: Redis;
  const createdEmails: string[] = [];

  async function flushRateLimitBucket(): Promise<void> {
    const keys = await redis.keys("ratelimit:ShopsController:register:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  // RateLimitGuard runs before body validation (guards precede pipes in
  // Nest's request lifecycle), so every call here -- valid or not --
  // counts against the same IP-only 3/hr bucket (§85, same shape as
  // /auth/register). Each test gets a fresh bucket so it can reason
  // about its own request count in isolation, same fix
  // rate-limit.e2e-spec.ts already documents for /auth/register.
  beforeEach(async () => {
    await flushRateLimitBucket();
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } }); // cascades shop_staff, refresh_tokens
    }
    await app.close();
  });

  it("creates a Shop + SHOP_OWNER User + ShopStaff + version-1 PricingRule, and the returned tokens work on an authenticated shop-owner route", async () => {
    const body = validBody();
    createdEmails.push(body.owner.email);

    const res = await request(app.getHttpServer()).post("/v1/shops/register").send(body);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(body.owner.email);
    expect(res.body.user.role).toBe("SHOP_OWNER");
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.owner.email } });
    expect(user.role).toBe(UserRole.SHOP_OWNER);
    expect(user.name).toBe(body.owner.name);

    const shop = await prisma.shop.findFirstOrThrow({ where: { name: body.shop.name } });
    expect(shop.address).toBe(body.shop.address);
    expect(shop.status).toBe("OPEN");
    expect(shop.capabilities).toMatchObject(body.shop.capabilities);

    const staff = await prisma.shopStaff.findUniqueOrThrow({
      where: { shopId_userId: { shopId: shop.id, userId: user.id } },
    });
    expect(staff.role).toBe(UserRole.SHOP_OWNER);
    expect(staff.status).toBe("ACTIVE");

    const pricingRule = await prisma.pricingRule.findUniqueOrThrow({
      where: { shopId_version: { shopId: shop.id, version: 1 } },
    });
    expect(pricingRule.currency).toBe(body.pricing.currency);
    expect(pricingRule.pricePerPageMinor).toBe(body.pricing.pricePerPageMinor);
    expect(pricingRule.colorSurchargePerPageMinor).toBe(body.pricing.colorSurchargePerPageMinor);
    expect(pricingRule.minimumChargeMinor).toBe(body.pricing.minimumChargeMinor);

    // the returned accessToken actually authenticates against a real
    // shop-owner route, and reports the right shopId/role.
    const meRes = await request(app.getHttpServer())
      .get("/v1/shop/staff/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(body.owner.email);
    expect(meRes.body.shops).toHaveLength(1);
    expect(meRes.body.shops[0]).toMatchObject({ id: shop.id, role: "SHOP_OWNER" });
  });

  it("rejects a duplicate owner email", async () => {
    const body = validBody();
    createdEmails.push(body.owner.email);

    const first = await request(app.getHttpServer()).post("/v1/shops/register").send(body);
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post("/v1/shops/register")
      .send(validBody({ ownerEmail: body.owner.email }));
    expect(second.status).toBe(409);
  });

  // Regression: the outer findUnique() doesn't close the race under READ
  // COMMITTED -- two concurrent requests for the same email can both pass
  // their own SELECT before either INSERT commits. users.email @unique
  // still prevents a duplicate row, but without translating the loser's
  // raw P2002 into the same 409, it fell through to a generic 500. Fire
  // two identical requests genuinely in parallel: exactly one must win
  // with 201, the other must get 409 -- never 500.
  it("resolves a genuinely concurrent duplicate-email race as 201 + 409, never 500", async () => {
    const email = `shop-registration-e2e-race-${randomUUID()}@print-automated.dev`;
    createdEmails.push(email);
    const shopName = `Self-Service Print Shop Race ${randomUUID()}`;

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post("/v1/shops/register")
        .send(validBody({ ownerEmail: email, shopName: `${shopName} A` })),
      request(app.getHttpServer())
        .post("/v1/shops/register")
        .send(validBody({ ownerEmail: email, shopName: `${shopName} B` })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const users = await prisma.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);
  });

  it("rejects negative pricing values with validation, never reaching the DB", async () => {
    const body = validBody();
    body.pricing.pricePerPageMinor = -1;

    const res = await request(app.getHttpServer()).post("/v1/shops/register").send(body);
    expect(res.status).toBe(400);

    const user = await prisma.user.findUnique({ where: { email: body.owner.email } });
    expect(user).toBeNull();
  });

  it("rejects a minimumChargeMinor below zero with validation", async () => {
    const body = validBody();
    body.pricing.minimumChargeMinor = -1;

    const res = await request(app.getHttpServer()).post("/v1/shops/register").send(body);
    expect(res.status).toBe(400);
  });

  it("rejects missing shop capabilities / required fields with validation", async () => {
    const body = validBody() as Record<string, unknown>;
    delete (body.shop as Record<string, unknown>).capabilities;

    const res = await request(app.getHttpServer()).post("/v1/shops/register").send(body);
    expect(res.status).toBe(400);
  });

  it("§85: signup is limited to 3 per hour per IP -- the 4th attempt returns 429", async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const body = validBody();
      createdEmails.push(body.owner.email);
      const res = await request(app.getHttpServer()).post("/v1/shops/register").send(body);
      expect(res.status).not.toBe(429);
    }

    const fourthBody = validBody();
    createdEmails.push(fourthBody.owner.email);
    const fourth = await request(app.getHttpServer()).post("/v1/shops/register").send(fourthBody);
    expect(fourth.status).toBe(429);
    expect(fourth.headers["retry-after"]).toBeDefined();
  }, 30_000);
});
