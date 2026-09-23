import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
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
import { RefundService } from "../src/payments/refund.service.js";
import { MockPaymentProvider } from "../src/payments/mock-payment-provider.js";

/** §45/16.6: a refund, a printer create/update/delete, a pairing-code
 * issue, and a shop-staff role change each produce a real audit row --
 * retrievable through 16.5's own `GET /admin/audit`, closing the loop
 * from "writes a row" to "someone can actually read it back." */
describe("Audit expansion (§45, 16.6, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let refundService: RefundService;
  let provider: MockPaymentProvider;

  let admin: { id: string; role: UserRole };
  let adminToken: string;
  let owner: { id: string; role: UserRole };
  let ownerToken: string;
  let shop: { id: string };
  let customer: { id: string };
  let documentId: string;

  const userIds: string[] = [];
  const printerIds: string[] = [];

  async function auditRowsFor(
    resourceType: string,
    resourceId?: string,
  ): Promise<Array<{ action: string; actorId: string | null; resourceId: string | null }>> {
    const res = await request(app.getHttpServer())
      .get(`/v1/admin/audit?resourceType=${resourceType}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{
      action: string;
      actorId: string | null;
      resourceId: string | null;
    }>;
    return resourceId ? items.filter((entry) => entry.resourceId === resourceId) : items;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    refundService = app.get(RefundService);
    provider = app.get(MockPaymentProvider);

    admin = await prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Audit E2E Admin",
        email: `audit-e2e-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(admin.id);
    adminToken = tokenService.issueAccessToken(admin);

    owner = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Audit E2E Owner",
        email: `audit-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(owner.id);
    ownerToken = tokenService.issueAccessToken(owner);

    shop = await prisma.shop.create({
      data: { name: `Audit E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: owner.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Audit E2E Customer",
        email: `audit-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(customer.id);

    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/audit-expansion/${randomUUID()}`,
        filename: "audit-expansion-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: [admin.id, owner.id] } }, { actorId: null }] },
    });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.refund.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.payment.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.order.deleteMany({ where: { shopId: shop.id } });
    await prisma.document.delete({ where: { id: documentId } });
    await prisma.shopStaff.deleteMany({ where: { shopId: shop.id } });
    await prisma.shop.delete({ where: { id: shop.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it("a refund produces a REFUND_SUCCEEDED audit row, retrievable via GET /admin/audit", async () => {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-AUDIT-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        documentId,
        printConfiguration: {},
        pricingSnapshot: { quote: { totalMinor: 1500, currency: "PKR" } },
        paymentStatus: PaymentStatus.PAID,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.name,
        providerPaymentId: `mock-audit-${randomUUID()}`,
        amountMinor: 1500,
        currency: "PKR",
        status: PaymentStatus.PAID,
      },
    });

    const refund = await refundService.requestRefund(payment.id, "customer requested", owner.id);
    expect(refund.status).toBe(PaymentStatus.REFUNDED);

    const rows = await auditRowsFor("refund", refund.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("REFUND_SUCCEEDED");
    expect(rows[0]?.actorId).toBe(owner.id);
  });

  it("printer create/update/delete each produce their own audit row", async () => {
    const registerRes = await request(app.getHttpServer())
      .post("/v1/shop/printers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shop.id, name: "Audit E2E Printer" });
    expect(registerRes.status).toBe(201);
    const printerId = registerRes.body.id as string;
    printerIds.push(printerId);

    const updateRes = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printerId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Audit E2E Printer Renamed" });
    expect(updateRes.status).toBe(200);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/v1/shop/printers/${printerId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(deleteRes.status).toBe(204);

    const rows = await auditRowsFor("printer", printerId);
    const actions = rows.map((r) => r.action).sort();
    expect(actions).toEqual(["PRINTER_CREATED", "PRINTER_REMOVED", "PRINTER_UPDATED"]);
    expect(rows.every((r) => r.actorId === owner.id)).toBe(true);
  });

  it("issuing a pairing code produces a PAIRING_CODE_ISSUED audit row", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/agents/pairing-code")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ shopId: shop.id });
    expect(res.status).toBe(201);

    const rows = await auditRowsFor("agent_pairing_code");
    const issued = rows.filter((r) => r.action === "PAIRING_CODE_ISSUED" && r.actorId === owner.id);
    expect(issued.length).toBeGreaterThanOrEqual(1);
  });

  it("a shop-staff role change produces a SHOP_STAFF_ROLE_CHANGED audit row", async () => {
    const target = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Audit E2E Role Change Target",
        email: `audit-e2e-role-change-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(target.id);
    const membership = await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: target.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/staff/${membership.id}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "SHOP_MANAGER" });
    expect(res.status).toBe(200);

    const rows = await auditRowsFor("shop_staff", membership.id);
    const roleChanged = rows.find((r) => r.action === "SHOP_STAFF_ROLE_CHANGED");
    expect(roleChanged).toBeDefined();
    expect(roleChanged?.actorId).toBe(owner.id);
  });
});
