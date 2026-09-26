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

describe("Products CRUD API (§13/17.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  // §47/17.3: MANAGE_PRICES is granted to SHOP_MANAGER/SHOP_OWNER, not
  // SHOP_COUNTER -- this fixture's ShopStaff.role at shop A is
  // SHOP_MANAGER (16.1: the effective, per-shop role, not the
  // account-level one) so every test below doubles as proof both that
  // the permission gate works and that it's scoped per-shop.
  let managerAtShopA: { id: string; role: UserRole };
  let managerAtShopB: { id: string; role: UserRole };
  let counterOnlyAtShopA: { id: string; role: UserRole };
  let managerAToken: string;
  let managerBToken: string;
  let counterOnlyToken: string;

  const productIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Products E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Products E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    managerAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_MANAGER,
        name: "Products E2E Manager A",
        email: `products-e2e-manager-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: managerAtShopA.id,
        role: UserRole.SHOP_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterOnlyAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Products E2E Counter-only A",
        email: `products-e2e-counter-only-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterOnlyAtShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    managerAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_MANAGER,
        name: "Products E2E Manager B",
        email: `products-e2e-manager-b-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopB.id,
        userId: managerAtShopB.id,
        role: UserRole.SHOP_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    managerAToken = tokenService.issueAccessToken(managerAtShopA);
    managerBToken = tokenService.issueAccessToken(managerAtShopB);
    counterOnlyToken = tokenService.issueAccessToken(counterOnlyAtShopA);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [managerAtShopA.id, managerAtShopB.id, counterOnlyAtShopA.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [managerAtShopA.id, managerAtShopB.id, counterOnlyAtShopA.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("creates a product with full metadata", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/products")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({
        shopId: shopA.id,
        name: "Business Cards (Premium)",
        description: "350gsm matte, double-sided",
        category: "Stationery",
        unit: "per pack of 100",
        taxRateBasisPoints: 1700,
        printerRequirements: { color: true, duplex: true, a4: false, a3: false },
        paperRequirements: { paperType: "CARD" },
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      shopId: shopA.id,
      name: "Business Cards (Premium)",
      category: "Stationery",
      available: true,
    });
    productIds.push(res.body.id);
  });

  it("creates a product with only the required fields, defaulting available to true", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/products")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ shopId: shopA.id, name: "Plain A4 Printout" });
    expect(res.status).toBe(201);
    expect(res.body.available).toBe(true);
    expect(res.body.description).toBeNull();
    productIds.push(res.body.id);
  });

  it("lists only the requesting shop's own products", async () => {
    const shopBProduct = await prisma.product.create({
      data: { shopId: shopB.id, name: "Shop B Product" },
    });
    productIds.push(shopBProduct.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/products?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.every((p: { shopId: string }) => p.shopId === shopA.id)).toBe(true);
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain(shopBProduct.id);
  });

  it("updates a product's fields", async () => {
    const product = await prisma.product.create({
      data: { shopId: shopA.id, name: "Old Name", available: true },
    });
    productIds.push(product.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: "New Name", available: false });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
    expect(res.body.available).toBe(false);
  });

  it("23.16: PATCH with an explicit null clears optional fields; omitted fields are untouched", async () => {
    const product = await prisma.product.create({
      data: {
        shopId: shopA.id,
        name: "Clearable",
        description: "old description",
        category: "Stationery",
        unit: "per pack",
        taxRateBasisPoints: 1700,
        printerRequirements: { color: true, duplex: false, a4: true, a3: false },
        paperRequirements: { paperType: "CARD" },
      },
    });
    productIds.push(product.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({
        description: null,
        category: null,
        unit: null,
        taxRateBasisPoints: null,
        printerRequirements: null,
        paperRequirements: null,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Clearable",
      description: null,
      category: null,
      unit: null,
      taxRateBasisPoints: null,
      printerRequirements: null,
      paperRequirements: null,
    });
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.printerRequirements).toBeNull();
    expect(stored.paperRequirements).toBeNull();

    // Omitted stays; a name cannot be cleared.
    const keep = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ description: "back" });
    expect(keep.body).toMatchObject({ name: "Clearable", description: "back", category: null });
    const badName = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ name: null });
    expect(badName.status).toBe(400);
  });

  it("§47: SHOP_COUNTER (lacking MANAGE_PRICES) is blocked from create/list/update at the same shop a SHOP_MANAGER can act on", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/shop/products")
      .set("Authorization", `Bearer ${counterOnlyToken}`)
      .send({ shopId: shopA.id, name: "Should not create" });
    expect(created.status).toBe(403);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/products?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`);
    expect(list.status).toBe(403);

    const product = await prisma.product.create({ data: { shopId: shopA.id, name: "Guarded" } });
    productIds.push(product.id);
    const updated = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`)
      .send({ name: "Hijacked" });
    expect(updated.status).toBe(403);
  });

  it("cross-shop isolation: a shop cannot see or edit another shop's products", async () => {
    const shopAProduct = await prisma.product.create({
      data: { shopId: shopA.id, name: "Shop A Secret Product" },
    });
    productIds.push(shopAProduct.id);

    const listRes = await request(app.getHttpServer())
      .get(`/v1/shop/products?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${managerBToken}`);
    expect(listRes.status).toBe(403);

    const createRes = await request(app.getHttpServer())
      .post("/v1/shop/products")
      .set("Authorization", `Bearer ${managerBToken}`)
      .send({ shopId: shopA.id, name: "Injected via Shop B" });
    expect(createRes.status).toBe(403);

    const updateRes = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${shopAProduct.id}`)
      .set("Authorization", `Bearer ${managerBToken}`)
      .send({ name: "Hijacked from Shop B" });
    expect(updateRes.status).toBe(403);

    const stillThere = await prisma.product.findUniqueOrThrow({ where: { id: shopAProduct.id } });
    expect(stillThere.name).toBe("Shop A Secret Product");
  });

  it("update rejects an empty body", async () => {
    const product = await prisma.product.create({ data: { shopId: shopA.id, name: "P" } });
    productIds.push(product.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/products/${product.id}`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
