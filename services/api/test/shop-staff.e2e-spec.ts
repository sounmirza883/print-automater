import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** The Shop app has no other way to learn which shop it's operating
 * for -- the JWT carries no shop context. */
describe("GET /shop/staff/me (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string; name: string };
  let shopB: { id: string; name: string };
  let multiShopCounter: { id: string; role: UserRole };
  let unaffiliatedCounter: { id: string; role: UserRole };
  let customer: { id: string; role: UserRole };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Shop Staff E2E Shop A ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Shop Staff E2E Shop B ${randomUUID()}`,
        address: "2",
        status: ShopStatus.OPEN,
      },
    });

    multiShopCounter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Multi Shop Counter",
        email: `shop-staff-e2e-multi-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.createMany({
      data: [
        {
          shopId: shopA.id,
          userId: multiShopCounter.id,
          role: UserRole.SHOP_COUNTER,
          status: ShopStaffStatus.ACTIVE,
        },
        {
          shopId: shopB.id,
          userId: multiShopCounter.id,
          role: UserRole.SHOP_COUNTER,
          status: ShopStaffStatus.ACTIVE,
        },
      ],
    });

    unaffiliatedCounter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Unaffiliated Counter",
        email: `shop-staff-e2e-none-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Shop Staff E2E Customer",
        email: `shop-staff-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
  });

  afterAll(async () => {
    await prisma.shopStaff.deleteMany({ where: { userId: multiShopCounter.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [multiShopCounter.id, unaffiliatedCounter.id, customer.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("returns every active shop a multi-shop staff member belongs to", async () => {
    const token = tokenService.issueAccessToken(multiShopCounter);
    const res = await request(app.getHttpServer())
      .get("/v1/shop/staff/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.shops.map((s: { id: string }) => s.id).sort()).toEqual(
      [shopA.id, shopB.id].sort(),
    );
  });

  it("returns an empty list for shop-role staff with no active membership", async () => {
    const token = tokenService.issueAccessToken(unaffiliatedCounter);
    const res = await request(app.getHttpServer())
      .get("/v1/shop/staff/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.shops).toEqual([]);
  });

  it("returns 403 for a customer role", async () => {
    const token = tokenService.issueAccessToken(customer);
    const res = await request(app.getHttpServer())
      .get("/v1/shop/staff/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 with no bearer token", async () => {
    const res = await request(app.getHttpServer()).get("/v1/shop/staff/me");
    expect(res.status).toBe(401);
  });
});
