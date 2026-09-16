import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentStatus, OrderStatus, ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** §32/§34/8.2's own Done-when: "Shop A staff receive zero shop B
 * orders, verified at the query layer rather than by filtering after
 * the fact." Orders are seeded directly at whichever orderStatus each
 * test needs (the "seed an arbitrary status" technique payments-
 * checkout.e2e-spec.ts already uses) -- this suite is about the read
 * side of the shop orders API, not re-proving the state machine. */
describe("Shop orders API (8.2, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let counterATokan: string;
  let counterBToken: string;
  let customerToken: string;

  const orderIds: string[] = [];

  async function seedOrder(shopId: string, orderStatus: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-SHOPORD-${randomUUID()}`,
        customerId: customer.id,
        shopId,
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 2,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 4000, currency: "PKR" } },
        orderStatus,
      },
    });
    orderIds.push(order.id);
    return order.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Shop Orders E2E Customer",
        email: `shop-orders-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/shop-orders/${randomUUID()}`,
        filename: "shop-orders-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shopA = await prisma.shop.create({
      data: {
        name: `Shop Orders E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Shop Orders E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Shop Orders E2E Counter A",
        email: `shop-orders-e2e-counter-a-${randomUUID()}@print-automated.dev`,
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
        name: "Shop Orders E2E Counter B",
        email: `shop-orders-e2e-counter-b-${randomUUID()}@print-automated.dev`,
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

    counterATokan = tokenService.issueAccessToken(counterAtShopA);
    counterBToken = tokenService.issueAccessToken(counterAtShopB);
    customerToken = tokenService.issueAccessToken(customer);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, counterAtShopB.id] } },
    });
    // deleteMany, not delete -- Document.owner cascades on the
    // customer's own deletion above, so this row may already be gone.
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({
      where: { id: { in: [customer.id, counterAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("groups shop A's own orders by operational state and excludes shop B's entirely", async () => {
    const needsAttention = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);
    const printing = await seedOrder(shopA.id, OrderStatus.PRINTING);
    const ready = await seedOrder(shopA.id, OrderStatus.READY_FOR_COLLECTION);
    const completed = await seedOrder(shopA.id, OrderStatus.COMPLETED);
    const failed = await seedOrder(shopA.id, OrderStatus.PRINT_FAILED);
    // Not shop-relevant yet -- must not appear in any group.
    await seedOrder(shopA.id, OrderStatus.PAYMENT_PENDING);
    // Shop B's own order -- must never appear for shop A staff, at any
    // query layer, not just filtered out of the response afterward.
    const shopBOrder = await seedOrder(shopB.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterATokan}`);

    expect(res.status).toBe(200);
    expect(res.body.needsAttention.map((o: { id: string }) => o.id)).toEqual([needsAttention]);
    expect(res.body.printing.map((o: { id: string }) => o.id)).toEqual([printing]);
    expect(res.body.ready.map((o: { id: string }) => o.id)).toEqual([ready]);
    expect(res.body.completed.map((o: { id: string }) => o.id)).toEqual([completed]);
    expect(res.body.failed.map((o: { id: string }) => o.id)).toEqual([failed]);

    const allIds = [
      ...res.body.needsAttention,
      ...res.body.printing,
      ...res.body.ready,
      ...res.body.completed,
      ...res.body.failed,
    ].map((o: { id: string }) => o.id);
    expect(allIds).not.toContain(shopBOrder);

    expect(res.body.needsAttention[0].customerName).toBe("Shop Orders E2E Customer");
    expect(res.body.needsAttention[0].documentFilename).toBe("shop-orders-test.pdf");
  });

  it("shop B staff see shop B's own orders (the tenant boundary blocks cross-shop access, not same-shop access)", async () => {
    const shopBOrder = await seedOrder(shopB.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${shopB.id}`)
      .set("Authorization", `Bearer ${counterBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.needsAttention.map((o: { id: string }) => o.id)).toContain(shopBOrder);
  });

  it("returns 403 when a shopId query param names a shop the caller doesn't staff", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${shopB.id}`)
      .set("Authorization", `Bearer ${counterATokan}`);
    expect(res.status).toBe(403);
  });

  it("returns 400 when shopId is missing or not a valid uuid", async () => {
    const missing = await request(app.getHttpServer())
      .get("/v1/shop/orders")
      .set("Authorization", `Bearer ${counterATokan}`);
    expect(missing.status).toBe(400);

    const malformed = await request(app.getHttpServer())
      .get("/v1/shop/orders?shopId=not-a-uuid")
      .set("Authorization", `Bearer ${counterATokan}`);
    expect(malformed.status).toBe(400);
  });

  it("returns 403 for a role that doesn't satisfy @Roles(shop staff), even with a real bearer token", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 401 with no bearer token at all", async () => {
    const res = await request(app.getHttpServer()).get(`/v1/shop/orders?shopId=${shopA.id}`);
    expect(res.status).toBe(401);
  });

  it("GET /shop/orders/:id returns full detail for shop A staff on shop A's own order", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${orderId}`)
      .set("Authorization", `Bearer ${counterATokan}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
    expect(res.body.customerName).toBe("Shop Orders E2E Customer");
    expect(res.body.documentFilename).toBe("shop-orders-test.pdf");
    expect(res.body.orderStatus).toBe("WAITING_FOR_SHOP");
  });

  it("GET /shop/orders/:id returns 403 when shop A staff request a shop B order", async () => {
    const shopBOrder = await seedOrder(shopB.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${shopBOrder}`)
      .set("Authorization", `Bearer ${counterATokan}`);
    expect(res.status).toBe(403);
  });

  it("GET /shop/orders/:id returns 403 (not a leaking 404) for a nonexistent order id", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/orders/${randomUUID()}`)
      .set("Authorization", `Bearer ${counterATokan}`);
    expect(res.status).toBe(403);
  });
});
