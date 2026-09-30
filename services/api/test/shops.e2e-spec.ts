import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStatus } from "@prisma/client";
import type { ApiEnv } from "@print-automated/config";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import type { ShopListItem } from "../src/shops/shops.service.js";

describe("Shop discovery (4.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const runId = randomUUID();
  let fullServiceShopId: string;
  let basicShopId: string;
  let unconfiguredShopId: string;
  let closedShopId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);

    const fullService = await prisma.shop.create({
      data: {
        name: `Discovery E2E Full-Service ${runId}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    const basic = await prisma.shop.create({
      data: {
        name: `Discovery E2E Basic ${runId}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    const unconfigured = await prisma.shop.create({
      data: {
        name: `Discovery E2E Unconfigured ${runId}`,
        address: "3 Test Street",
        status: ShopStatus.OPEN,
        capabilities: undefined,
      },
    });
    const closed = await prisma.shop.create({
      data: {
        name: `Discovery E2E Closed ${runId}`,
        address: "4 Test Street",
        status: ShopStatus.CLOSED,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });

    fullServiceShopId = fullService.id;
    basicShopId = basic.id;
    unconfiguredShopId = unconfigured.id;
    closedShopId = closed.id;
  });

  afterAll(async () => {
    await prisma.shop.deleteMany({
      where: { id: { in: [fullServiceShopId, basicShopId, unconfiguredShopId, closedShopId] } },
    });
    await app.close();
  });

  function names(body: ShopListItem[]): string[] {
    return body.map((shop) => shop.name).filter((name) => name.includes(runId));
  }

  it("with no filters, returns every OPEN shop (including one with no declared capabilities) but never a CLOSED one", async () => {
    const res = await request(app.getHttpServer()).get("/v1/shops");
    expect(res.status).toBe(200);

    const found = names(res.body as ShopListItem[]);
    expect(found).toEqual(
      expect.arrayContaining([
        `Discovery E2E Full-Service ${runId}`,
        `Discovery E2E Basic ${runId}`,
        `Discovery E2E Unconfigured ${runId}`,
      ]),
    );
    expect(found).not.toContain(`Discovery E2E Closed ${runId}`);
  });

  it("§18: a color+duplex request excludes the mono/simplex shop", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/shops")
      .query({ color: "true", duplex: "true" });
    expect(res.status).toBe(200);

    const found = names(res.body as ShopListItem[]);
    expect(found).toContain(`Discovery E2E Full-Service ${runId}`);
    expect(found).not.toContain(`Discovery E2E Basic ${runId}`);
  });

  it("a shop with no declared capabilities is excluded from any filtered search, never guessed into it", async () => {
    const res = await request(app.getHttpServer()).get("/v1/shops").query({ color: "true" });
    expect(res.status).toBe(200);

    const found = names(res.body as ShopListItem[]);
    expect(found).not.toContain(`Discovery E2E Unconfigured ${runId}`);
  });

  it("§107: a CLOSED shop never appears, filtered or not", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/shops")
      .query({ color: "true", duplex: "true" });
    expect(res.status).toBe(200);

    const found = names(res.body as ShopListItem[]);
    expect(found).not.toContain(`Discovery E2E Closed ${runId}`);
  });

  it("carries the placeholder distance/ETA fields as explicit null, not a fabricated number", async () => {
    const res = await request(app.getHttpServer()).get("/v1/shops");
    const shop = (res.body as ShopListItem[]).find(
      (item) => item.name === `Discovery E2E Full-Service ${runId}`,
    );
    expect(shop?.distanceKm).toBeNull();
    expect(shop?.estimatedProcessingTimeMinutes).toBeNull();
  });

  it("rejects an unknown paper size before ever querying the database", async () => {
    // 15.1 expanded PaperSize to include A3 -- use a value that's
    // still outside the enum after that expansion.
    const res = await request(app.getHttpServer()).get("/v1/shops").query({ paper: "TABLOID" });
    expect(res.status).toBe(400);
  });

  it("fix wave 1: there is no public self-service business signup -- POST /shops/register is gone (404), and creates nothing", async () => {
    const name = `Discovery E2E Would-Be Signup ${runId}`;
    const res = await request(app.getHttpServer())
      .post("/v1/shops/register")
      .send({
        shop: {
          name,
          address: "5 Test Street",
          capabilities: { color: true, duplex: true, a4: true, a3: false },
        },
        owner: {
          name: "Self Signup",
          email: `self-signup-${runId}@print-automated.dev`,
          password: "a-real-password",
        },
        pricing: {
          currency: "PKR",
          pricePerPageMinor: 1000,
          colorSurchargePerPageMinor: 0,
          minimumChargeMinor: 0,
        },
      });
    expect(res.status).toBe(404);
    expect(await prisma.shop.count({ where: { name } })).toBe(0);
    expect(
      await prisma.user.count({ where: { email: `self-signup-${runId}@print-automated.dev` } }),
    ).toBe(0);
  });
});
