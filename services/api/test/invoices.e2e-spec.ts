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

describe("Invoices and receipts (§36/17.7, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shop: { id: string };
  let otherShop: { id: string };
  let customer: { id: string; role: UserRole };
  let strangerCustomer: { id: string; role: UserRole };
  let staffAtShop: { id: string; role: UserRole };
  let staffAtOtherShop: { id: string; role: UserRole };
  let customerToken: string;
  let strangerCustomerToken: string;
  let staffToken: string;
  let otherStaffToken: string;

  let orderId: string;
  const documentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shop = await prisma.shop.create({
      data: {
        name: `Invoices E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    otherShop = await prisma.shop.create({
      data: {
        name: `Invoices E2E Other Shop ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
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

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Invoices E2E Customer",
        email: `invoices-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    strangerCustomer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Invoices E2E Stranger",
        email: `invoices-e2e-stranger-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    staffAtShop = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Invoices E2E Staff",
        email: `invoices-e2e-staff-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: staffAtShop.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    staffAtOtherShop = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Invoices E2E Other Shop Staff",
        email: `invoices-e2e-other-staff-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: otherShop.id,
        userId: staffAtOtherShop.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    customerToken = tokenService.issueAccessToken(customer);
    strangerCustomerToken = tokenService.issueAccessToken(strangerCustomer);
    staffToken = tokenService.issueAccessToken(staffAtShop);
    otherStaffToken = tokenService.issueAccessToken(staffAtOtherShop);

    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: customer.id,
        storageKey: `documents/${documentId}`,
        filename: "invoice-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 10,
      },
    });
    documentIds.push(documentId);

    const orderRes = await request(app.getHttpServer())
      .post("/v1/orders")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ documentId, shopId: shop.id, printConfiguration: CONFIG });
    expect(orderRes.status).toBe(201);
    orderId = orderRes.body.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { resourceType: "order", resourceId: orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.pricingRule.deleteMany({ where: { shopId: shop.id } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [staffAtShop.id, staffAtOtherShop.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [customer.id, strangerCustomer.id, staffAtShop.id, staffAtOtherShop.id] },
      },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shop.id, otherShop.id] } } });
    await app.close();
  });

  it("the owning customer downloads a real PDF invoice", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}/invoice`)
      .set("Authorization", `Bearer ${customerToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(200);
  });

  it("an unrelated customer is rejected (403, not a leaked 404)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}/invoice`)
      .set("Authorization", `Bearer ${strangerCustomerToken}`);
    expect(res.status).toBe(403);
  });

  it("shop staff at the owning shop download the same order's invoice", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/invoice`)
      .set("Authorization", `Bearer ${staffToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect((res.body as Buffer).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("a different shop's staff is rejected", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}/invoice`)
      .set("Authorization", `Bearer ${otherStaffToken}`);
    expect(res.status).toBe(403);
  });

  it("§82: the invoice is generated from the order's own stored snapshot, never a live pricing rule -- it still generates correctly even after every PricingRule row for the shop is deleted", async () => {
    // Not a hypothetical: actually remove every pricing_rules row this
    // shop has. If InvoicesService read a live rule at all, this would
    // 404/500 instead of succeeding.
    await prisma.pricingRule.deleteMany({ where: { shopId: shop.id } });

    const res = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}/invoice`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);

    // Restore for afterAll's own (now redundant, but harmless) cleanup.
    await prisma.pricingRule.create({
      data: {
        shopId: shop.id,
        version: 2,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });
  });
});
