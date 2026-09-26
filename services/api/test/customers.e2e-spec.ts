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

describe("Customer records API (§33/34/17.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let counterAToken: string;
  let counterBToken: string;

  const customerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Customers E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Customers E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Customers E2E Counter A",
        email: `customers-e2e-counter-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterAtShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Customers E2E Counter B",
        email: `customers-e2e-counter-b-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopB.id,
        userId: counterAtShopB.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAToken = tokenService.issueAccessToken(counterAtShopA);
    counterBToken = tokenService.issueAccessToken(counterAtShopB);
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [counterAtShopA.id, counterAtShopB.id] } } });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("SHOP_COUNTER creates a walk-in customer (CREATE_ORDERS covers this, not MANAGE_USERS)", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Ayesha Khan", phone: "+923001234567" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ shopId: shopA.id, name: "Ayesha Khan", active: true });
    customerIds.push(res.body.id);
  });

  it("two different customers can share the same phone number -- no uniqueness constraint", async () => {
    const first = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Household A", phone: "+923009999999" });
    const second = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Household B", phone: "+923009999999" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.id).not.toBe(second.body.id);
    customerIds.push(first.body.id, second.body.id);
  });

  it("searches by partial name/phone/email match", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Bilal Searchable Test", email: "bilal.search@example.com" });
    customerIds.push(created.body.id);

    const byName = await request(app.getHttpServer())
      .get(`/v1/shop/customers?shopId=${shopA.id}&q=searchable`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(byName.status).toBe(200);
    expect(byName.body.map((c: { id: string }) => c.id)).toContain(created.body.id);

    const byEmail = await request(app.getHttpServer())
      .get(`/v1/shop/customers?shopId=${shopA.id}&q=bilal.search@example.com`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(byEmail.body.map((c: { id: string }) => c.id)).toContain(created.body.id);

    const noMatch = await request(app.getHttpServer())
      .get(`/v1/shop/customers?shopId=${shopA.id}&q=zzz-no-such-customer-zzz`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(noMatch.body).toEqual([]);
  });

  it("updates a customer's fields, including deactivating them", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "To Be Updated" });
    customerIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ name: "Updated Name", active: false });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
    expect(res.body.active).toBe(false);
  });

  it("cross-shop isolation: a shop cannot see, search, create for, or edit another shop's customers", async () => {
    const shopACustomer = await prisma.customer.create({
      data: { shopId: shopA.id, name: "Shop A Only Customer" },
    });
    customerIds.push(shopACustomer.id);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/customers?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(list.status).toBe(403);

    const create = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterBToken}`)
      .send({ shopId: shopA.id, name: "Injected from Shop B" });
    expect(create.status).toBe(403);

    const update = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${shopACustomer.id}`)
      .set("Authorization", `Bearer ${counterBToken}`)
      .send({ name: "Hijacked" });
    expect(update.status).toBe(403);

    const stillThere = await prisma.customer.findUniqueOrThrow({ where: { id: shopACustomer.id } });
    expect(stillThere.name).toBe("Shop A Only Customer");
  });

  it("23.16: PATCH with an explicit null clears optional contact fields; omitted fields are untouched", async () => {
    const created = await prisma.customer.create({
      data: {
        shopId: shopA.id,
        name: "Clear Me",
        phone: "+923001112222",
        email: "clear.me@example.test",
        company: "Acme",
        address: "1 Road",
      },
    });
    customerIds.push(created.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${created.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ phone: null, email: null, company: null, address: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Clear Me",
      phone: null,
      email: null,
      company: null,
      address: null,
    });

    const keep = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${created.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ phone: "+923009998888" });
    expect(keep.body).toMatchObject({ name: "Clear Me", phone: "+923009998888", email: null });
    const badName = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${created.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ name: null });
    expect(badName.status).toBe(400);
  });

  it("update rejects an empty body", async () => {
    const created = await prisma.customer.create({ data: { shopId: shopA.id, name: "P" } });
    customerIds.push(created.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/customers/${created.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
