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

/** §4.2/§11/17.5, e2e: the full counter-ordering journey -- create a
 * walk-in customer, upload a document on their behalf, configure,
 * quote, and confirm -- produces a real order with the right
 * ownership shape. */
describe("Counter-placed orders (§4.2/§11/17.5, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let printerManagerAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let counterAToken: string;
  let printerManagerAToken: string;
  let counterBToken: string;

  const orderIds: string[] = [];
  const documentIds: string[] = [];
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
        name: `Counter Orders E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Counter Orders E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    await prisma.pricingRule.create({
      data: {
        shopId: shopA.id,
        version: 1,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Counter Orders E2E Counter A",
        email: `counter-orders-e2e-counter-a-${randomUUID()}@print-automated.dev`,
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

    // §47: PRINTER_MANAGER has no CREATE_ORDERS -- used below to prove
    // the permission gate, same shop as counterAtShopA.
    printerManagerAtShopA = await prisma.user.create({
      data: {
        role: UserRole.PRINTER_MANAGER,
        name: "Counter Orders E2E Printer Manager A",
        email: `counter-orders-e2e-pm-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: printerManagerAtShopA.id,
        role: UserRole.PRINTER_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Counter Orders E2E Counter B",
        email: `counter-orders-e2e-counter-b-${randomUUID()}@print-automated.dev`,
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
    printerManagerAToken = tokenService.issueAccessToken(printerManagerAtShopA);
    counterBToken = tokenService.issueAccessToken(counterAtShopB);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.pricingRule.deleteMany({ where: { shopId: shopA.id } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, printerManagerAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [counterAtShopA.id, printerManagerAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("full flow: create customer -> upload document -> configure -> quote -> confirm produces a real order with customerRecordId set and customerId = the staff member", async () => {
    // 1. Create (or find) the walk-in customer.
    const customerRes = await request(app.getHttpServer())
      .post("/v1/shop/customers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Walk-in Customer Zainab", phone: "+923005550000" });
    expect(customerRes.status).toBe(201);
    const customerRecordId: string = customerRes.body.id;
    customerIds.push(customerRecordId);

    // 2. Upload a document on the customer's behalf, staff-owned --
    // reusing the existing presigned-URL flow verbatim (documents.e2e-
    // spec.ts's own pattern), rather than a parallel upload path.
    const fakePdfBytes = Buffer.from("%PDF-1.7\ncounter order e2e test\n%%EOF");
    const createDocRes = await request(app.getHttpServer())
      .post("/v1/documents")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({
        filename: "counter-order-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: fakePdfBytes.length,
      });
    expect(createDocRes.status).toBe(201);
    const documentId: string = createDocRes.body.documentId;
    documentIds.push(documentId);

    const putResponse = await fetch(createDocRes.body.uploadUrl, {
      method: "PUT",
      body: fakePdfBytes,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(putResponse.ok).toBe(true);

    const confirmRes = await request(app.getHttpServer())
      .post(`/v1/documents/${documentId}/upload`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("PROCESSING");

    // The document's own document is owned by the STAFF member
    // (ownerUserId), not the walk-in Customer record -- Customer has
    // no login to own anything with.
    const documentRow = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(documentRow.ownerUserId).toBe(counterAtShopA.id);

    // Flip straight to READY (11.5/worker's own real scan+encrypt
    // pipeline is out of scope for this API-level e2e test, the same
    // shortcut orders.e2e-spec.ts's own fixture already takes) so
    // quoting/confirming can proceed.
    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY, pageCount: 10 },
    });

    // 3/4/5. Configure, quote (implicitly, inside create), and confirm.
    const orderRes = await request(app.getHttpServer())
      .post("/v1/shop/orders")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({
        shopId: shopA.id,
        documentId,
        customerRecordId,
        printConfiguration: CONFIG,
      });
    expect(orderRes.status).toBe(201);
    orderIds.push(orderRes.body.id);

    expect(orderRes.body.customerRecordId).toBe(customerRecordId);
    expect(orderRes.body.creationSource).toBe("COUNTER");
    expect(orderRes.body.orderStatus).toBe("UPLOADED");
    expect(orderRes.body.pricingSnapshot.quote.subtotalMinor).toBe(10_000);

    // customerId (non-nullable) is the STAFF member's own User id --
    // 17.5's own judgment call, documented on Order.customerId itself.
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: orderRes.body.id } });
    expect(orderRow.customerId).toBe(counterAtShopA.id);
    expect(orderRow.customerRecordId).toBe(customerRecordId);
    expect(orderRow.creationSource).toBe("COUNTER");

    // The shop's own order list shows the walk-in customer's real
    // name, not the staff member's.
    const shopOrderRes = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${orderRes.body.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(shopOrderRes.status).toBe(200);
    expect(shopOrderRes.body.customerName).toBe("Walk-in Customer Zainab");
  });

  it("§47: a role without CREATE_ORDERS (PRINTER_MANAGER) cannot place a counter order", async () => {
    const customer = await prisma.customer.create({
      data: { shopId: shopA.id, name: "Blocked Attempt Customer" },
    });
    customerIds.push(customer.id);
    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: printerManagerAtShopA.id,
        storageKey: `documents/${documentId}`,
        filename: "blocked.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
      },
    });
    documentIds.push(documentId);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/orders")
      .set("Authorization", `Bearer ${printerManagerAToken}`)
      .send({
        shopId: shopA.id,
        documentId,
        customerRecordId: customer.id,
        printConfiguration: CONFIG,
      });
    expect(res.status).toBe(403);
  });

  it("rejects a customerRecordId belonging to a different shop", async () => {
    const shopBCustomer = await prisma.customer.create({
      data: { shopId: shopB.id, name: "Shop B Only Customer" },
    });
    customerIds.push(shopBCustomer.id);
    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: counterAtShopA.id,
        storageKey: `documents/${documentId}`,
        filename: "cross-shop.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
      },
    });
    documentIds.push(documentId);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/orders")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({
        shopId: shopA.id,
        documentId,
        customerRecordId: shopBCustomer.id,
        printConfiguration: CONFIG,
      });
    expect(res.status).toBe(403);
  });

  it("cross-shop isolation: a shop cannot place a counter order for another shop", async () => {
    const customer = await prisma.customer.create({
      data: { shopId: shopA.id, name: "Hijack Target Customer" },
    });
    customerIds.push(customer.id);
    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: counterAtShopB.id,
        storageKey: `documents/${documentId}`,
        filename: "hijack.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 5,
      },
    });
    documentIds.push(documentId);

    const res = await request(app.getHttpServer())
      .post("/v1/shop/orders")
      .set("Authorization", `Bearer ${counterBToken}`)
      .send({
        shopId: shopA.id,
        documentId,
        customerRecordId: customer.id,
        printConfiguration: CONFIG,
      });
    expect(res.status).toBe(403);
  });
});
