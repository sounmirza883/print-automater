import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, ShopStatus, UserRole } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
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

describe("Order quote (4.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let env: ApiEnv;

  let owner: { id: string; role: UserRole };
  let stranger: { id: string; role: UserRole };
  let ownerToken: string;
  let strangerToken: string;

  let readyDocumentId: string;
  let openShopId: string;
  let closedShopId: string;
  let unconfiguredPricingShopId: string;
  let monoOnlyShopId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    env = app.get<ApiEnv>(API_ENV);

    owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Quote E2E Owner",
        email: `quote-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    stranger = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Quote E2E Stranger",
        email: `quote-e2e-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerToken = tokenService.issueAccessToken(owner);
    strangerToken = tokenService.issueAccessToken(stranger);

    // getStatus() (reused from 2.x) only ever reads the row -- quoting
    // never touches storage/KMS, so this document doesn't need a real
    // encrypted object behind it, unlike 2.8's download tests.
    readyDocumentId = randomUUID();
    await prisma.document.create({
      data: {
        id: readyDocumentId,
        ownerUserId: owner.id,
        storageKey: `documents/${readyDocumentId}`,
        filename: "quote-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 10,
        checksum: "irrelevant-for-this-test",
      },
    });

    const openShop = await prisma.shop.create({
      data: {
        name: `Quote E2E Open Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    openShopId = openShop.id;
    await prisma.pricingRule.create({
      data: {
        shopId: openShopId,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });

    const closedShop = await prisma.shop.create({
      data: {
        name: `Quote E2E Closed Shop ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.CLOSED,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    closedShopId = closedShop.id;

    const unconfiguredPricingShop = await prisma.shop.create({
      data: {
        name: `Quote E2E No Pricing Shop ${randomUUID()}`,
        address: "3 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    unconfiguredPricingShopId = unconfiguredPricingShop.id;

    const monoOnlyShop = await prisma.shop.create({
      data: {
        name: `Quote E2E Mono-Only Shop ${randomUUID()}`,
        address: "4 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    monoOnlyShopId = monoOnlyShop.id;
    await prisma.pricingRule.create({
      data: {
        shopId: monoOnlyShopId,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 600,
        colorSurchargePerPageMinor: 0,
        otherCharges: [],
        minimumChargeMinor: 500,
      },
    });
  });

  afterAll(async () => {
    await prisma.pricingRule.deleteMany({
      where: { shopId: { in: [openShopId, monoOnlyShopId] } },
    });
    await prisma.document.deleteMany({ where: { id: readyDocumentId } });
    await prisma.shop.deleteMany({
      where: { id: { in: [openShopId, closedShopId, unconfiguredPricingShopId, monoOnlyShopId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await app.close();
  });

  it("§19: a client-supplied total is ignored entirely -- the server value always wins", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        documentId: readyDocumentId,
        shopId: openShopId,
        printConfiguration: CONFIG,
        // A client trying to smuggle its own total through -- must have
        // zero effect on the response.
        total: 1,
        totalMinor: 1,
      });

    expect(res.status).toBe(200);
    // 10 pages x 2 copies x Rs 10.00/page = Rs 200.00 (20000), well
    // above the Rs 10.00 minimum; + the configured platform fee.
    expect(res.body.subtotalMinor).toBe(20000);
    expect(res.body.platformFeeMinor).toBe(env.PLATFORM_FEE_MINOR);
    expect(res.body.totalMinor).toBe(20000 + env.PLATFORM_FEE_MINOR);
    expect(res.body.documentId).toBe(readyDocumentId);
    expect(res.body.shopId).toBe(openShopId);
  });

  it("a color request against a mono-only shop is refused, not silently mispriced", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        documentId: readyDocumentId,
        shopId: monoOnlyShopId,
        printConfiguration: { ...CONFIG, color: "COLOR" },
      });
    expect(res.status).toBe(422);
    expect(res.body.error_code).toBe("SHOP_CANNOT_FULFIL_CONFIGURATION");
  });

  it("a CLOSED shop is refused for quoting", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId: closedShopId, printConfiguration: CONFIG });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("SHOP_NOT_ACCEPTING_ORDERS");
  });

  it("a shop with no pricing rule configured yet is refused rather than silently priced at zero", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        documentId: readyDocumentId,
        shopId: unconfiguredPricingShopId,
        printConfiguration: CONFIG,
      });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("SHOP_PRICING_NOT_CONFIGURED");
  });

  it("a stranger cannot quote against someone else's document", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ documentId: readyDocumentId, shopId: openShopId, printConfiguration: CONFIG });
    expect(res.status).toBe(403);
  });

  it("a nonexistent shop is a 404, distinct from the 409s above", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ documentId: readyDocumentId, shopId: randomUUID(), printConfiguration: CONFIG });
    expect(res.status).toBe(404);
  });

  it("an unauthenticated request is rejected before touching any of this", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/orders/quote")
      .send({ documentId: readyDocumentId, shopId: openShopId, printConfiguration: CONFIG });
    expect(res.status).toBe(401);
  });
});
