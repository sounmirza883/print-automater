import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderCreationSource,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
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

/** 23.13/23.16: the enriched shop order detail (items, contact, payment, per-job
 * timestamps, pricing-rule version) and the non-admin order history timeline. */
describe("Shop order detail and history (23.13, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};

  let shopA: { id: string };
  let shopB: { id: string };
  let selfServiceOrderId: string;
  let counterOrderId: string;
  let otherOrderId: string;
  let printerName: string;
  let jobId: string;
  let supersededJobId: string;
  const checkoutUrl = `https://pay.example/checkout/${randomUUID()}`;
  const providerPaymentId = `prov-${randomUUID()}`;

  const userIds: string[] = [];
  const shopIds: string[] = [];
  const orderIds: string[] = [];
  const docIds: string[] = [];

  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

  async function user(label: string, role: UserRole, extra: { phone?: string } = {}) {
    const u = await prisma.user.create({
      data: {
        role,
        name: `Detail E2E ${label}`,
        email: `detail-e2e-${label}-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
        ...extra,
      },
    });
    userIds.push(u.id);
    return u;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    const tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: { name: `Detail E2E A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Detail E2E B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });
    shopIds.push(shopA.id, shopB.id);

    for (const [key, role, shop] of [
      ["ownerA", UserRole.SHOP_OWNER, shopA],
      ["counterA", UserRole.SHOP_COUNTER, shopA],
      ["operatorA", UserRole.OPERATOR, shopA],
      ["ownerB", UserRole.SHOP_OWNER, shopB],
    ] as const) {
      const u = await user(key, role);
      await prisma.shopStaff.create({
        data: { shopId: shop.id, userId: u.id, role, status: ShopStaffStatus.ACTIVE },
      });
      tokens[key] = tokenService.issueAccessToken(u);
    }

    const customer = await user("customer", UserRole.CUSTOMER, { phone: "+92-300-1111111" });
    const staffForCounter = await prisma.user.findFirstOrThrow({
      where: { id: { in: userIds }, role: UserRole.SHOP_COUNTER },
    });
    const doc = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/detail/${randomUUID()}`,
        filename: "detail-main.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    const doc2 = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/detail/${randomUUID()}`,
        filename: "detail-cover.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    docIds.push(doc.id, doc2.id);

    const config = {
      pages: { mode: "all" },
      copies: 2,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-DETAIL-${randomUUID()}`,
        customerId: customer.id,
        shopId: shopA.id,
        documentId: doc.id,
        printConfiguration: config,
        pricingSnapshot: {
          pricingRuleVersion: 3,
          quote: { totalMinor: 4000, currency: "PKR" },
        },
        orderStatus: OrderStatus.QUEUED_FOR_PRINT,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    selfServiceOrderId = order.id;
    orderIds.push(order.id);

    const item1 = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        documentId: doc.id,
        printConfiguration: config,
        quantity: 2,
        itemType: OrderItemType.PRINT,
        sequence: 0,
        pricingSnapshot: { totalMinor: 3000 },
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        documentId: doc2.id,
        printConfiguration: config,
        quantity: 1,
        itemType: OrderItemType.PRINT,
        sequence: 1,
        pricingSnapshot: { totalMinor: 1000 },
      },
    });

    printerName = `Detail Printer ${randomUUID()}`;
    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, name: printerName, status: PrinterStatus.ONLINE },
    });
    const old = await prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId: printer.id,
        shopId: shopA.id,
        orderItemId: item1.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.CANCELLED,
        supersededAt: new Date(),
        attempt: 1,
      },
    });
    supersededJobId = old.id;
    const job = await prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId: printer.id,
        shopId: shopA.id,
        orderItemId: item1.id,
        idempotencyToken: randomUUID(),
        status: PrintJobStatus.QUEUED,
        attempt: 2,
        priority: 5,
        pausedAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    jobId = job.id;

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        providerPaymentId,
        checkoutUrl,
        amountMinor: 4000,
        currency: "PKR",
        status: PaymentStatus.REFUNDED,
      },
    });
    await prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        amountMinor: 1000,
        currency: "PKR",
        status: PaymentStatus.REFUNDED,
        reason: "goodwill",
      },
    });

    // A counter order for a walk-in customer record.
    const walkIn = await prisma.customer.create({
      data: {
        shopId: shopA.id,
        name: "Walk In Wendy",
        phone: "+92-321-0000000",
        email: "wendy@example.test",
      },
    });
    const counterOrder = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-DETAIL-${randomUUID()}`,
        customerId: staffForCounter.id,
        customerRecordId: walkIn.id,
        creationSource: OrderCreationSource.COUNTER,
        shopId: shopA.id,
        documentId: doc.id,
        printConfiguration: config,
        pricingSnapshot: { quote: { totalMinor: 500, currency: "PKR" } },
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
      },
    });
    counterOrderId = counterOrder.id;
    orderIds.push(counterOrder.id);

    const other = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-DETAIL-${randomUUID()}`,
        customerId: customer.id,
        shopId: shopA.id,
        documentId: doc.id,
        printConfiguration: config,
        pricingSnapshot: { quote: { totalMinor: 100, currency: "PKR" } },
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
      },
    });
    otherOrderId = other.id;
    orderIds.push(other.id);

    // Audit trail rows, at increasing times.
    const base = Date.now() - 60_000;
    const rows: Array<{
      action: string;
      resourceType: string;
      resourceId: string;
      metadata?: object;
    }> = [
      { action: "ORDER_SHOP_ACCEPT", resourceType: "order", resourceId: order.id },
      {
        action: "PRINT_JOB_QUEUE",
        resourceType: "print_job",
        resourceId: supersededJobId,
        metadata: { from: "CREATED", to: "QUEUED", token: "secret-token-value" },
      },
      {
        action: "JOB_REASSIGNED",
        resourceType: "print_job",
        resourceId: jobId,
        metadata: { deliveryAddress: "12 Secret Lane", checkoutUrl, reason: "manual" },
      },
      {
        action: "PRINT_JOB_LATE_PRINT_SUCCESSOR",
        resourceType: "print_job",
        resourceId: supersededJobId,
        metadata: { successorJobId: jobId },
      },
      {
        action: "INVENTORY_SHORTFALL",
        resourceType: "print_job",
        resourceId: jobId,
        metadata: { shortfallSheets: 2 },
      },
      {
        action: "INVENTORY_CONSUMPTION_FAILED",
        resourceType: "print_job",
        resourceId: jobId,
        metadata: { error: "boom" },
      },
      { action: "PAYMENT_STATUS_CHANGED", resourceType: "payment", resourceId: payment.id },
      // Another order's rows must never appear.
      { action: "ORDER_SHOP_ACCEPT", resourceType: "order", resourceId: other.id },
    ];
    let i = 0;
    for (const row of rows) {
      await prisma.auditLog.create({
        data: {
          actorId: userIds[0],
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          metadata: row.metadata,
          createdAt: new Date(base + i * 1000),
        },
      });
      i += 1;
    }
  });

  afterAll(async () => {
    const jobs = await prisma.printJob.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const resourceIds = [...orderIds, ...jobs.map((j) => j.id), ...payments.map((p) => p.id)];
    await prisma.auditLog.deleteMany({ where: { resourceId: { in: resourceIds } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.printer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.document.deleteMany({ where: { id: { in: docIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("GET /v1/shop/orders/:id (enriched)", () => {
    it("returns line items with document name, quantity, config, status and price", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("ownerA"));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        sequence: 0,
        itemType: "PRINT",
        documentName: "detail-main.pdf",
        quantity: 2,
        status: "QUEUED",
        priceMinor: 3000,
      });
      expect(res.body.items[0].printConfiguration.paperSize).toBe("A4");
      expect(res.body.items[1]).toMatchObject({
        documentName: "detail-cover.pdf",
        status: null,
        priceMinor: 1000,
      });
    });

    it("returns the customer contact (account holder) and payment detail with a refunds summary", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("ownerA"));
      expect(res.body.customerContact).toMatchObject({
        kind: "ACCOUNT",
        phone: "+92-300-1111111",
      });
      expect(res.body.customerContact.email).toMatch(/^detail-e2e-customer-/);
      expect(res.body.payment).toMatchObject({
        provider: "mock",
        status: "REFUNDED",
        amountMinor: 4000,
        currency: "PKR",
      });
      expect(res.body.refunds).toEqual({
        count: 1,
        refundedMinor: 1000,
        pendingMinor: 0,
        currency: "PKR",
      });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(checkoutUrl);
      expect(raw).not.toContain(providerPaymentId);
    });

    it("returns a walk-in customer's own contact for a counter order", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${counterOrderId}`)
        .set(auth("counterA"));
      expect(res.status).toBe(200);
      expect(res.body.customerContact).toEqual({
        kind: "WALK_IN",
        name: "Walk In Wendy",
        phone: "+92-321-0000000",
        email: "wendy@example.test",
      });
      // No item rows yet: one is synthesised from the order itself.
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ id: null, quantity: 2, priceMinor: 500 });
      expect(res.body.payment).toBeNull();
    });

    it("hides phone/email from roles that cannot manage deliveries (operator) but keeps the name", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("operatorA"));
      expect(res.status).toBe(200);
      expect(res.body.customerContact).toMatchObject({
        name: "Detail E2E customer",
        phone: null,
        email: null,
        contactRedacted: true,
      });
      expect(res.body.items).toHaveLength(2);
    });

    it("exposes per-job timestamps, attempt, priority, and the order's priority", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("ownerA"));
      // The superseded job is not a current job.
      expect(res.body.printJobs).toHaveLength(1);
      const job = res.body.printJobs[0];
      expect(job.id).toBe(jobId);
      expect(job).toMatchObject({
        attempt: 2,
        priority: 5,
        printerName,
        pausedAt: "2026-01-02T00:00:00.000Z",
        supersededAt: null,
        blockedReason: null,
      });
      expect(typeof job.createdAt).toBe("string");
      expect(typeof job.updatedAt).toBe("string");
      expect(res.body.priority).toBe(5);
    });

    it("stays additive: every pre-existing field is still present", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("ownerA"));
      for (const key of [
        "id",
        "publicOrderNumber",
        "customerName",
        "documentFilename",
        "printConfiguration",
        "pricingSnapshot",
        "paymentStatus",
        "orderStatus",
        "createdAt",
        "printerName",
        "printJobs",
        "qualityCheckStatus",
        "delivery",
      ]) {
        expect(res.body).toHaveProperty(key);
      }
      expect(res.body.customerName).toBe("Detail E2E customer");
    });

    it("a business B owner cannot read a business A order (403)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}`)
        .set(auth("ownerB"));
      expect(res.status).toBe(403);
    });
  });

  describe("GET /v1/shop/orders/:id/history", () => {
    it("returns the order's timeline (order, job, payment rows), oldest first, and no other order's rows", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}/history`)
        .set(auth("counterA"));
      expect(res.status).toBe(200);
      const actions = res.body.items.map((row: { action: string }) => row.action);
      expect(actions).toEqual([
        "ORDER_SHOP_ACCEPT",
        "PRINT_JOB_QUEUE",
        "JOB_REASSIGNED",
        "PRINT_JOB_LATE_PRINT_SUCCESSOR",
        "INVENTORY_SHORTFALL",
        "INVENTORY_CONSUMPTION_FAILED",
        "PAYMENT_STATUS_CHANGED",
      ]);
      expect(res.body.total).toBe(7);
      const first = res.body.items[0];
      expect(first).toMatchObject({
        resourceType: "order",
        resourceId: selfServiceOrderId,
      });
      expect(first.actor).toMatchObject({ name: expect.stringContaining("Detail E2E") });
      expect(first.at).toBeDefined();
    });

    it("redacts secrets, checkout links and delivery addresses from row metadata", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}/history`)
        .set(auth("ownerA"));
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("secret-token-value");
      expect(raw).not.toContain("12 Secret Lane");
      expect(raw).not.toContain(checkoutUrl);
      const reassigned = res.body.items.find(
        (row: { action: string }) => row.action === "JOB_REASSIGNED",
      );
      expect(reassigned.metadata.reason).toBe("manual");
    });

    it("is paginated (limit/offset, always the envelope) and rejects deep offsets", async () => {
      const page = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}/history`)
        .query({ limit: 3, offset: 2 })
        .set(auth("ownerA"));
      expect(page.status).toBe(200);
      expect(page.body.limit).toBe(3);
      expect(page.body.offset).toBe(2);
      expect(page.body.total).toBe(7);
      expect(page.body.items.map((r: { action: string }) => r.action)).toEqual([
        "JOB_REASSIGNED",
        "PRINT_JOB_LATE_PRINT_SUCCESSOR",
        "INVENTORY_SHORTFALL",
      ]);
      const deep = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}/history`)
        .query({ offset: 10001 })
        .set(auth("ownerA"));
      expect(deep.status).toBe(400);
    });

    it("is readable by an operator (VIEW_ORDERS)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${counterOrderId}/history`)
        .set(auth("operatorA"));
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it("refuses a business B owner, an unknown order, and an anonymous caller", async () => {
      const crossShop = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${selfServiceOrderId}/history`)
        .set(auth("ownerB"));
      expect(crossShop.status).toBe(403);
      const unknown = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${randomUUID()}/history`)
        .set(auth("ownerA"));
      expect(unknown.status).toBe(403);
      const anon = await request(app.getHttpServer()).get(
        `/v1/shop/orders/${selfServiceOrderId}/history`,
      );
      expect(anon.status).toBe(401);
      // The other order's own timeline holds only its own row.
      const other = await request(app.getHttpServer())
        .get(`/v1/shop/orders/${otherOrderId}/history`)
        .set(auth("ownerA"));
      expect(other.body.items.map((r: { action: string }) => r.action)).toEqual([
        "ORDER_SHOP_ACCEPT",
      ]);
    });
  });
});
