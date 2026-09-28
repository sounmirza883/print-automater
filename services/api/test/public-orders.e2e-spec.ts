import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import type Redis from "ioredis";
import { DocumentStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, REDIS_CLIENT } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AuditAction } from "../src/audit/audit-action.js";
import { PUBLIC_RATE_LIMITS } from "../src/public-orders/public-orders.controller.js";

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

const GUEST_NAME = "QR Guest Zainab Khan";
const GUEST_PHONE = "+92 300 555 1234";

/** 24.1 (QR guest ordering), e2e: a guest who scanned a shop's QR code
 * uploads a document and places an order with NO auth header at all. The
 * order is attributed to the shop's lazily created SYSTEM user (so the
 * non-nullable Order.customerId always points at a real User), and the
 * guest's own name/phone become a Customer row at customerRecordId --
 * the same shape as a counter order (counter-orders.e2e-spec.ts). */
describe("Public QR ordering (24.1, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: Redis;

  let openShop: { id: string };
  let otherOpenShop: { id: string };
  let closedShop: { id: string };
  const shopIds: string[] = [];

  async function clearPublicRateLimits(): Promise<void> {
    const keys = await redis.keys("ratelimit:PublicOrdersController:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  async function createShop(status: ShopStatus, label: string): Promise<{ id: string }> {
    const shop = await prisma.shop.create({
      data: {
        name: `Public Orders E2E ${label} ${randomUUID()}`,
        address: "1 QR Street",
        status,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    shopIds.push(shop.id);
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
    return shop;
  }

  /** The two-step public upload (create -> PUT to the presigned URL ->
   * confirm), then READY by hand: the worker's real scan/encrypt pipeline
   * is out of scope here, the same shortcut counter-orders.e2e-spec.ts takes. */
  async function uploadReadyDocument(shopId: string): Promise<string> {
    const bytes = Buffer.from("%PDF-1.7\npublic qr order e2e\n%%EOF");
    const createRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${shopId}/documents`)
      .send({ filename: "qr-order.pdf", mimeType: "application/pdf", sizeBytes: bytes.length });
    expect(createRes.status).toBe(201);
    const documentId: string = createRes.body.documentId;

    const put = await fetch(createRes.body.uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(put.ok).toBe(true);

    const confirmRes = await request(app.getHttpServer()).post(
      `/v1/public/shops/${shopId}/documents/${documentId}/upload`,
    );
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("PROCESSING");

    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY, pageCount: 10 },
    });
    return documentId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS_CLIENT);
    // Every request in this suite comes from the same test-runner IP, and
    // the hour-long windows do not self-clear between runs.
    await clearPublicRateLimits();

    openShop = await createShop(ShopStatus.OPEN, "Open");
    otherOpenShop = await createShop(ShopStatus.OPEN, "Other Open");
    closedShop = await createShop(ShopStatus.CLOSED, "Closed");
  });

  afterAll(async () => {
    await clearPublicRateLimits();
    const shops = await prisma.shop.findMany({
      where: { id: { in: shopIds } },
      select: { qrSystemUserId: true },
    });
    const systemUserIds = shops.flatMap((s) => (s.qrSystemUserId ? [s.qrSystemUserId] : []));
    const orders = await prisma.order.findMany({
      where: { shopId: { in: shopIds } },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({ where: { resourceId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.document.deleteMany({ where: { ownerUserId: { in: systemUserIds } } });
    await prisma.customer.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.pricingRule.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({ where: { id: { in: systemUserIds } } });
    await app.close();
  });

  it("with no auth header: upload -> poll -> order produces a QR order owned by the shop's SYSTEM user, the guest as its Customer record", async () => {
    const documentId = await uploadReadyDocument(openShop.id);

    // The status route the guest's page polls until the worker is done.
    const statusRes = await request(app.getHttpServer()).get(
      `/v1/public/shops/${openShop.id}/documents/${documentId}`,
    );
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({ id: documentId, status: "READY", pageCount: 10 });

    const orderRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/orders`)
      .send({ name: GUEST_NAME, phone: GUEST_PHONE, documentId, printConfiguration: CONFIG });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.creationSource).toBe("QR");
    expect(orderRes.body.orderStatus).toBe("UPLOADED");
    expect(orderRes.body.shopId).toBe(openShop.id);
    expect(orderRes.body.pricingSnapshot.quote.subtotalMinor).toBe(10_000);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: openShop.id } });
    expect(shop.qrSystemUserId).not.toBeNull();
    // The synthetic account's id is plumbing, never handed to the guest.
    expect(orderRes.body).not.toHaveProperty("customerId");
    expect(JSON.stringify(orderRes.body)).not.toContain(shop.qrSystemUserId);
    const systemUser = await prisma.user.findUniqueOrThrow({
      where: { id: shop.qrSystemUserId! },
    });
    expect(systemUser.role).toBe(UserRole.SYSTEM);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderRes.body.id } });
    expect(order.customerId).toBe(shop.qrSystemUserId);
    expect(order.creationSource).toBe("QR");
    expect(order.customerRecordId).toBe(orderRes.body.customerRecordId);

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: order.customerRecordId! },
    });
    expect(customer).toMatchObject({ shopId: openShop.id, name: GUEST_NAME, phone: GUEST_PHONE });

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.ownerUserId).toBe(shop.qrSystemUserId);

    // Audited, with the guest's name and phone masked, never raw.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: AuditAction.QR_ORDER_CREATED, resourceId: order.id },
    });
    expect(audit.actorId).toBe(shop.qrSystemUserId);
    expect(audit.metadata).toMatchObject({
      shopId: openShop.id,
      customerRecordId: customer.id,
      nameMasked: "Q***",
      phoneMasked: "***34",
    });
    const auditJson = JSON.stringify(audit.metadata);
    expect(auditJson).not.toContain(GUEST_NAME);
    expect(auditJson).not.toContain("Zainab");
    expect(auditJson).not.toContain(GUEST_PHONE);
    expect(auditJson).not.toContain("5551234");
  });

  it("a second order to the same shop reuses the same qrSystemUserId (created once, not per order)", async () => {
    const before = await prisma.shop.findUniqueOrThrow({ where: { id: openShop.id } });
    expect(before.qrSystemUserId).not.toBeNull();

    const documentId = await uploadReadyDocument(openShop.id);
    const orderRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/orders`)
      .send({ name: "Second Guest", phone: "03001112233", documentId, printConfiguration: CONFIG });
    expect(orderRes.status).toBe(201);

    const after = await prisma.shop.findUniqueOrThrow({ where: { id: openShop.id } });
    expect(after.qrSystemUserId).toBe(before.qrSystemUserId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderRes.body.id } });
    expect(order.customerId).toBe(before.qrSystemUserId);

    const orders = await prisma.order.findMany({ where: { shopId: openShop.id } });
    expect(orders.length).toBe(2);
    expect(new Set(orders.map((o) => o.customerId)).size).toBe(1);
    // Each order still has its own guest.
    expect(new Set(orders.map((o) => o.customerRecordId)).size).toBe(2);
  });

  it("concurrent first requests to a fresh shop still provision exactly one SYSTEM user", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        request(app.getHttpServer())
          .post(`/v1/public/shops/${otherOpenShop.id}/documents`)
          .send({ filename: "race.pdf", mimeType: "application/pdf", sizeBytes: 1024 }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);

    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: otherOpenShop.id } });
    const owners = await prisma.document.findMany({
      where: { id: { in: results.map((r) => r.body.documentId as string) } },
      select: { ownerUserId: true },
    });
    expect(new Set(owners.map((d) => d.ownerUserId))).toEqual(new Set([shop.qrSystemUserId]));
  });

  it("rejects a shop that is not OPEN (409), without provisioning anything for it", async () => {
    const docRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${closedShop.id}/documents`)
      .send({ filename: "closed.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
    expect(docRes.status).toBe(409);
    expect(docRes.body.error_code).toBe("SHOP_NOT_ACCEPTING_ORDERS");

    const orderRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${closedShop.id}/orders`)
      .send({
        name: GUEST_NAME,
        phone: GUEST_PHONE,
        documentId: randomUUID(),
        printConfiguration: CONFIG,
      });
    expect(orderRes.status).toBe(409);
    expect(orderRes.body.error_code).toBe("SHOP_NOT_ACCEPTING_ORDERS");

    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: closedShop.id } });
    expect(shop.qrSystemUserId).toBeNull();
    expect(await prisma.customer.count({ where: { shopId: closedShop.id } })).toBe(0);
  });

  it("404s for a shop that does not exist", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/public/shops/${randomUUID()}/documents`)
      .send({ filename: "nowhere.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
    expect(res.status).toBe(404);
  });

  it("applies exactly the authenticated upload's file type/size validation (400), never weaker", async () => {
    const tooBig = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/documents`)
      .send({ filename: "huge.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);

    const wrongType = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/documents`)
      .send({ filename: "virus.exe", mimeType: "application/x-msdownload", sizeBytes: 1024 });
    expect(wrongType.status).toBe(400);
  });

  it("a document uploaded through one shop's QR code cannot be confirmed, read or ordered through another shop's", async () => {
    const documentId = await uploadReadyDocument(openShop.id);

    const confirmRes = await request(app.getHttpServer()).post(
      `/v1/public/shops/${otherOpenShop.id}/documents/${documentId}/upload`,
    );
    expect(confirmRes.status).toBe(404);

    const statusRes = await request(app.getHttpServer()).get(
      `/v1/public/shops/${otherOpenShop.id}/documents/${documentId}`,
    );
    expect(statusRes.status).toBe(404);

    const customersBefore = await prisma.customer.count({ where: { shopId: otherOpenShop.id } });
    const orderRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${otherOpenShop.id}/orders`)
      .send({ name: GUEST_NAME, phone: GUEST_PHONE, documentId, printConfiguration: CONFIG });
    expect(orderRes.status).toBe(404);
    // Refused before the guest's Customer row was written.
    expect(await prisma.customer.count({ where: { shopId: otherOpenShop.id } })).toBe(
      customersBefore,
    );
  });

  it("a document that is not READY yet is refused (409) without leaving a Customer row behind", async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/documents`)
      .send({ filename: "pending.pdf", mimeType: "application/pdf", sizeBytes: 1024 });
    expect(createRes.status).toBe(201);

    const customersBefore = await prisma.customer.count({ where: { shopId: openShop.id } });
    const orderRes = await request(app.getHttpServer())
      .post(`/v1/public/shops/${openShop.id}/orders`)
      .send({
        name: GUEST_NAME,
        phone: GUEST_PHONE,
        documentId: createRes.body.documentId,
        printConfiguration: CONFIG,
      });
    expect(orderRes.status).toBe(409);
    expect(orderRes.body.error_code).toBe("DOCUMENT_NOT_READY");
    expect(await prisma.customer.count({ where: { shopId: openShop.id } })).toBe(customersBefore);
  });

  describe("rate limiting (keyed by IP+shop AND by IP)", () => {
    const { perIpAndShop, perIp } = PUBLIC_RATE_LIMITS.createOrder;

    beforeEach(clearPublicRateLimits);

    it(`one IP gets ${perIpAndShop} order attempts per shop, then 429 -- while another shop is still reachable`, async () => {
      const shopId = randomUUID();
      for (let attempt = 1; attempt <= perIpAndShop; attempt++) {
        // An empty body: counted by the guard (which runs before validation),
        // then refused by validation -- 400, never 429, inside the budget.
        const res = await request(app.getHttpServer())
          .post(`/v1/public/shops/${shopId}/orders`)
          .send({});
        expect(res.status).toBe(400);
      }

      const over = await request(app.getHttpServer())
        .post(`/v1/public/shops/${shopId}/orders`)
        .send({});
      expect(over.status).toBe(429);
      expect(Number(over.headers["retry-after"])).toBeGreaterThan(0);
      expect(over.body).toMatchObject({ error_code: "RATE_LIMITED", retryable: true });

      // The same IP hitting a DIFFERENT shop has its own per-shop budget.
      const otherShop = await request(app.getHttpServer())
        .post(`/v1/public/shops/${randomUUID()}/orders`)
        .send({});
      expect(otherShop.status).toBe(400);
    });

    it(`one IP cannot spread past ${perIp} order attempts across many shops`, async () => {
      const perShop = perIpAndShop - 1; // always inside each shop's own budget
      let sent = 0;
      while (sent < perIp) {
        const shopId = randomUUID();
        for (let i = 0; i < perShop && sent < perIp; i++, sent++) {
          const res = await request(app.getHttpServer())
            .post(`/v1/public/shops/${shopId}/orders`)
            .send({});
          expect(res.status).toBe(400);
        }
      }

      const over = await request(app.getHttpServer())
        .post(`/v1/public/shops/${randomUUID()}/orders`)
        .send({});
      expect(over.status).toBe(429);
    });

    it("the document routes are rate limited too", async () => {
      const { perIpAndShop: docLimit } = PUBLIC_RATE_LIMITS.createDocument;
      const shopId = randomUUID();
      for (let attempt = 1; attempt <= docLimit; attempt++) {
        const res = await request(app.getHttpServer())
          .post(`/v1/public/shops/${shopId}/documents`)
          .send({});
        expect(res.status).toBe(400);
      }
      const over = await request(app.getHttpServer())
        .post(`/v1/public/shops/${shopId}/documents`)
        .send({});
      expect(over.status).toBe(429);
    });
  });
});
