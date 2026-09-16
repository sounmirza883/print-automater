import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PrinterStatus,
  ShopStaffStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** §36/8.3, e2e: accept/reject/ready/complete, each validated through
 * the real OrderStateMachine (5.4), against real Postgres rows. */
describe("Shop order actions API (8.3, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let printerA: { id: string };
  let counterAToken: string;
  let counterBToken: string;

  const orderIds: string[] = [];
  const printerIds: string[] = [];

  async function seedOrder(shopId: string, orderStatus: OrderStatus): Promise<string> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-SHOPACT-${randomUUID()}`,
        customerId: customer.id,
        shopId,
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 2000, currency: "PKR" } },
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
        name: "Shop Actions E2E Customer",
        email: `shop-actions-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });

    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/shop-actions/${randomUUID()}`,
        filename: "shop-actions-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shopA = await prisma.shop.create({
      data: {
        name: `Shop Actions E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Shop Actions E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, name: "Shop A Printer 1", status: PrinterStatus.OFFLINE },
    });
    printerA = printer;
    printerIds.push(printer.id);

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Shop Actions E2E Counter A",
        email: `shop-actions-e2e-counter-a-${randomUUID()}@print-automated.dev`,
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
        name: "Shop Actions E2E Counter B",
        email: `shop-actions-e2e-counter-b-${randomUUID()}@print-automated.dev`,
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
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({
      where: { id: { in: [customer.id, counterAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("accept moves the order to QUEUED_FOR_PRINT and creates exactly one print job, even double-tapped", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);

    const first = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(first.status).toBe(200);
    expect(first.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const second = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(second.status).toBe(200);
    expect(second.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const jobs = await prisma.printJob.findMany({ where: { orderId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.printerId).toBe(printerA.id);
    expect(jobs[0]?.shopId).toBe(shopA.id);
    expect(jobs[0]?.status).toBe("QUEUED");

    const acceptAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SHOP_ACCEPT" },
    });
    expect(acceptAudits).toBe(1);
    const queueAudits = await prisma.auditLog.count({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_QUEUE_PRINT" },
    });
    expect(queueAudits).toBe(1);
  });

  it("accept fails with 409 when the shop has no non-disabled printer, and leaves the order at WAITING_FOR_SHOP", async () => {
    const orderId = await seedOrder(shopB.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
    const jobs = await prisma.printJob.count({ where: { orderId } });
    expect(jobs).toBe(0);
  });

  it("accept ignores a DISABLED printer -- same 409 as having none at all", async () => {
    const disabledPrinter = await prisma.printer.create({
      data: { shopId: shopB.id, name: "Shop B Disabled Printer", status: PrinterStatus.DISABLED },
    });
    printerIds.push(disabledPrinter.id);
    const orderId = await seedOrder(shopB.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
  });

  it("accept returns 403 when shop B staff target a shop A order", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(res.status).toBe(403);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
  });

  it("reject requires a reason (400) and, given one, moves the order to SHOP_REJECTED", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);

    const missingReason = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/reject`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({});
    expect(missingReason.status).toBe(400);

    const invalidReason = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/reject`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ reason: "NOT_A_REAL_REASON" });
    expect(invalidReason.status).toBe(400);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);

    const rejected = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/reject`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ reason: "PRINTER_UNAVAILABLE" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.orderStatus).toBe("SHOP_REJECTED");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceType: "order", resourceId: orderId, action: "ORDER_SHOP_REJECT" },
    });
    expect((audit.metadata as { reason?: string } | null)?.reason).toBe("PRINTER_UNAVAILABLE");
  });

  it("ready moves PRINTED -> READY_FOR_COLLECTION, and is refused from the wrong state", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.PRINTED);

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/ready`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orderStatus).toBe("READY_FOR_COLLECTION");

    const tooEarly = await seedOrder(shopA.id, OrderStatus.WAITING_FOR_SHOP);
    const refused = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${tooEarly}/ready`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(refused.status).toBe(409);
  });

  it("complete moves READY_FOR_COLLECTION -> COMPLETED and sets completed_at", async () => {
    const orderId = await seedOrder(shopA.id, OrderStatus.READY_FOR_COLLECTION);

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/complete`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orderStatus).toBe("COMPLETED");

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.completedAt).not.toBeNull();
  });
});
