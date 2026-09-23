import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
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

describe("Manual payment recording (§35/17.6, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  let counterAtShopA: { id: string; role: UserRole };
  let operatorAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let counterAToken: string;
  let operatorAToken: string;
  let counterBToken: string;

  const orderIds: string[] = [];
  const documentIds: string[] = [];

  async function createUploadedOrder(): Promise<{ orderId: string; documentId: string }> {
    const documentId = randomUUID();
    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: counterAtShopA.id,
        storageKey: `documents/${documentId}`,
        filename: "manual-payment-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        status: DocumentStatus.READY,
        pageCount: 10,
      },
    });
    documentIds.push(documentId);

    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `PA-MANUALPAY-${randomUUID()}`,
        customerId: counterAtShopA.id,
        shopId: shopA.id,
        documentId,
        printConfiguration: {},
        pricingSnapshot: {
          pricingRuleVersion: 1,
          pricingRule: {},
          quote: {
            lineItems: [],
            subtotalMinor: 10_000,
            taxMinor: 0,
            platformFeeMinor: 0,
            totalMinor: 10_000,
            currency: "PKR",
          },
        },
        orderStatus: OrderStatus.UPLOADED,
        paymentStatus: PaymentStatus.PENDING,
      },
    });
    orderIds.push(order.id);
    return { orderId: order.id, documentId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Manual Payments E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Manual Payments E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Manual Payments E2E Counter A",
        email: `manual-payments-e2e-counter-a-${randomUUID()}@print-automated.dev`,
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

    // §47: OPERATOR has VIEW_ORDERS but not EDIT_ORDERS.
    operatorAtShopA = await prisma.user.create({
      data: {
        role: UserRole.OPERATOR,
        name: "Manual Payments E2E Operator A",
        email: `manual-payments-e2e-operator-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: operatorAtShopA.id,
        role: UserRole.OPERATOR,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Manual Payments E2E Counter B",
        email: `manual-payments-e2e-counter-b-${randomUUID()}@print-automated.dev`,
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
    operatorAToken = tokenService.issueAccessToken(operatorAtShopA);
    counterBToken = tokenService.issueAccessToken(counterAtShopB);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { resourceType: "payment", resourceId: { in: await paymentIdsForOrders() } },
    });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, operatorAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [counterAtShopA.id, operatorAtShopA.id, counterAtShopB.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  async function paymentIdsForOrders(): Promise<string[]> {
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    return payments.map((p) => p.id);
  }

  it("records a manual payment, creating a Payment row and transitioning the order to PAID then WAITING_FOR_SHOP", async () => {
    const { orderId } = await createUploadedOrder();

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orderStatus).toBe("WAITING_FOR_SHOP");
    expect(res.body.paymentStatus).toBe("PAID");

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.provider).toBe("manual");
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.amountMinor).toBe(10_000);

    // Audited with the correct actor.
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { resourceType: "payment", resourceId: payment.id, action: "MANUAL_PAYMENT_RECORDED" },
    });
    expect(auditRow.actorId).toBe(counterAtShopA.id);
  });

  it("rejects a second call for the same order with a real 409, not a silent no-op or a double-transition", async () => {
    const { orderId } = await createUploadedOrder();

    const first = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(second.status).toBe(409);
    expect(second.body.error_code).toBe("ORDER_NOT_AWAITING_PAYMENT");

    // Still exactly one Payment row -- no double-count.
    const payments = await prisma.payment.findMany({ where: { orderId } });
    expect(payments).toHaveLength(1);
  });

  it("rejects recording a manual payment on an order that's already PAID", async () => {
    const { orderId } = await createUploadedOrder();
    await prisma.order.update({
      where: { id: orderId },
      data: { orderStatus: OrderStatus.WAITING_FOR_SHOP, paymentStatus: PaymentStatus.PAID },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("ORDER_NOT_AWAITING_PAYMENT");
  });

  it("§47: OPERATOR (lacking EDIT_ORDERS) cannot record a manual payment", async () => {
    const { orderId } = await createUploadedOrder();

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${operatorAToken}`);
    expect(res.status).toBe(403);
  });

  it("cross-shop isolation: a different shop's staff cannot record a payment on this order", async () => {
    const { orderId } = await createUploadedOrder();

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/record-payment`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(res.status).toBe(403);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
  });
});
