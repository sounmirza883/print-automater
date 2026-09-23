import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
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

describe("Pricing rule versions API (§4.2/§19/17.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let managerAtShopA: { id: string; role: UserRole };
  let managerAtShopB: { id: string; role: UserRole };
  let counterOnlyAtShopA: { id: string; role: UserRole };
  let customer: { id: string; role: UserRole };
  let managerAToken: string;
  let managerBToken: string;
  let counterOnlyToken: string;
  let customerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `PricingRules E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `PricingRules E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    managerAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_MANAGER,
        name: "PricingRules E2E Manager A",
        email: `pricing-rules-e2e-manager-a-${randomUUID()}@print-automated.dev`,
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
        name: "PricingRules E2E Counter-only A",
        email: `pricing-rules-e2e-counter-only-a-${randomUUID()}@print-automated.dev`,
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
        name: "PricingRules E2E Manager B",
        email: `pricing-rules-e2e-manager-b-${randomUUID()}@print-automated.dev`,
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

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "PricingRules E2E Customer",
        email: `pricing-rules-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    managerAToken = tokenService.issueAccessToken(managerAtShopA);
    managerBToken = tokenService.issueAccessToken(managerAtShopB);
    counterOnlyToken = tokenService.issueAccessToken(counterOnlyAtShopA);
    customerToken = tokenService.issueAccessToken(customer);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { shopId: shopA.id } });
    await prisma.document.deleteMany({ where: { ownerUserId: customer.id } });
    await prisma.pricingRule.deleteMany({ where: { shopId: { in: [shopA.id, shopB.id] } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [managerAtShopA.id, managerAtShopB.id, counterOnlyAtShopA.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [managerAtShopA.id, managerAtShopB.id, counterOnlyAtShopA.id, customer.id] },
      },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("creates version 1 when no rule exists yet, and it becomes current", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/pricing-rules")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({
        shopId: shopA.id,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      });
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/pricing-rules?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(list.status).toBe(200);
    expect(list.body[0].version).toBe(1);
  });

  it("a second create mints version 2, which immediately becomes current -- version 1 is never mutated", async () => {
    const v2Res = await request(app.getHttpServer())
      .post("/v1/shop/pricing-rules")
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({
        shopId: shopA.id,
        currency: "PKR",
        pricePerPageMinor: 1200,
        colorSurchargePerPageMinor: 600,
        otherCharges: [{ label: "Setup fee", amountMinor: 100 }],
        minimumChargeMinor: 1000,
        paperSizeSurchargePerPageMinor: { A3: 200 },
        finishingChargeMinor: { BINDING: 5000 },
        taxRateBasisPoints: 1700,
      });
    expect(v2Res.status).toBe(201);
    expect(v2Res.body.version).toBe(2);
    expect(v2Res.body.taxRateBasisPoints).toBe(1700);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/pricing-rules?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(list.body).toHaveLength(2);
    // Newest first -- the current rule.
    expect(list.body[0].version).toBe(2);
    expect(list.body[0].pricePerPageMinor).toBe(1200);
    // Version 1 still reads back completely unchanged.
    const v1 = list.body.find((r: { version: number }) => r.version === 1);
    expect(v1.pricePerPageMinor).toBe(1000);
  });

  it("§47: SHOP_COUNTER (lacking MANAGE_PRICES) cannot create or list pricing rules", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/shop/pricing-rules")
      .set("Authorization", `Bearer ${counterOnlyToken}`)
      .send({
        shopId: shopA.id,
        currency: "PKR",
        pricePerPageMinor: 1,
        colorSurchargePerPageMinor: 0,
        otherCharges: [],
        minimumChargeMinor: 0,
      });
    expect(created.status).toBe(403);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/pricing-rules?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`);
    expect(list.status).toBe(403);
  });

  it("cross-shop isolation: a shop cannot create or list another shop's pricing rules", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/shop/pricing-rules")
      .set("Authorization", `Bearer ${managerBToken}`)
      .send({
        shopId: shopA.id,
        currency: "PKR",
        pricePerPageMinor: 1,
        colorSurchargePerPageMinor: 0,
        otherCharges: [],
        minimumChargeMinor: 0,
      });
    expect(created.status).toBe(403);

    const list = await request(app.getHttpServer())
      .get(`/v1/shop/pricing-rules?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${managerBToken}`);
    expect(list.status).toBe(403);
  });

  // §82's own invariant, proven against the NEW write path this
  // sub-phase introduces: a confirmed order's stored pricingSnapshot
  // must never change when a shop creates a new pricing-rule version
  // afterward -- the single most important test in this sub-phase.
  it("§82: an already-created order's stored pricingSnapshot is unaffected by a new pricing-rule version created afterward", async () => {
    // A fresh shop with exactly one pricing-rule version, so the
    // order below unambiguously prices off it.
    const shop = await prisma.shop.create({
      data: {
        name: `PricingRules E2E Snapshot Shop ${randomUUID()}`,
        address: "3 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    await prisma.pricingRule.create({
      data: {
        shopId: shop.id,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });
    const owner = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Snapshot Shop Owner",
        email: `pricing-rules-e2e-snapshot-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: owner.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const ownerToken = tokenService.issueAccessToken(owner);

    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: customer.id,
        storageKey: `documents/${documentId}`,
        filename: "snapshot-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 10,
      },
    });

    const orderRes = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ documentId, shopId: shop.id, printConfiguration: CONFIG });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.id;
    const snapshotBefore = orderRes.body.pricingSnapshot;
    expect(snapshotBefore.pricingRuleVersion).toBe(1);
    expect(snapshotBefore.quote.subtotalMinor).toBe(10_000); // 10 pages x Rs 10.00

    // Reprice the shop -- a brand new, much higher version 2.
    const repriceRes = await request(app.getHttpServer())
      .post("/v1/shop/pricing-rules")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        shopId: shop.id,
        currency: "PKR",
        pricePerPageMinor: 999_999,
        colorSurchargePerPageMinor: 999_999,
        otherCharges: [],
        minimumChargeMinor: 999_999,
      });
    expect(repriceRes.status).toBe(201);
    expect(repriceRes.body.version).toBe(2);

    // The existing order's own snapshot is byte-for-byte unchanged.
    const getRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.pricingSnapshot).toEqual(snapshotBefore);
    expect(getRes.body.pricingSnapshot.pricingRuleVersion).toBe(1);
    expect(getRes.body.pricingSnapshot.quote.subtotalMinor).toBe(10_000);

    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.pricingRule.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({ where: { shopId: shop.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
  });
});
