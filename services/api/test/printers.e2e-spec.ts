import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PrinterStatus,
  PrintJobStatus,
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
import { branchIdOf } from "./helpers/branches.js";

describe("Printers CRUD API (8.4, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let shopA: { id: string };
  let shopB: { id: string };
  // §47/16.3: MANAGE_PRINTERS is granted to SHOP_MANAGER/SHOP_OWNER/
  // PRINTER_MANAGER, not SHOP_COUNTER -- this fixture's account-level
  // User.role stays SHOP_COUNTER (16.1: it's ShopStaff.role at shop A
  // that's authoritative here, and it's SHOP_MANAGER) so every test
  // below doubles as end-to-end proof of both 16.1 and 16.3 together.
  let counterAtShopA: { id: string; role: UserRole };
  let counterAtShopB: { id: string; role: UserRole };
  let counterOnlyAtShopA: { id: string; role: UserRole };
  let counterAToken: string;
  let counterBToken: string;
  let counterOnlyToken: string;

  const printerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: {
        name: `Printers E2E Shop A ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopB = await prisma.shop.create({
      data: {
        name: `Printers E2E Shop B ${randomUUID()}`,
        address: "2 Test Street",
        status: ShopStatus.OPEN,
      },
    });

    counterAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Printers E2E Counter A",
        email: `printers-e2e-counter-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterAtShopA.id,
        role: UserRole.SHOP_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterOnlyAtShopA = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Printers E2E Counter-only A",
        email: `printers-e2e-counter-only-a-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: counterOnlyAtShopA.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    counterAtShopB = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Printers E2E Counter B",
        email: `printers-e2e-counter-b-${randomUUID()}@print-automated.dev`,
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
    counterOnlyToken = tokenService.issueAccessToken(counterOnlyAtShopA);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { printerId: { in: printerIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.shopStaff.deleteMany({
      where: { userId: { in: [counterAtShopA.id, counterAtShopB.id, counterOnlyAtShopA.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [counterAtShopA.id, counterAtShopB.id, counterOnlyAtShopA.id] } },
    });
    await prisma.shop.deleteMany({ where: { id: { in: [shopA.id, shopB.id] } } });
    await app.close();
  });

  it("registers a printer with capabilities, defaulting to OFFLINE", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/printers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({
        shopId: shopA.id,
        name: "Front Desk HP LaserJet",
        capabilities: { color: false, duplex: true, a4: true, a3: false },
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Front Desk HP LaserJet");
    expect(res.body.status).toBe("OFFLINE");
    expect(res.body.capabilities).toEqual({ color: false, duplex: true, a4: true, a3: false });
    printerIds.push(res.body.id);
  });

  it("registers a printer with no declared capabilities at all", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/printers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopA.id, name: "Back Room Printer" });
    expect(res.status).toBe(201);
    expect(res.body.capabilities).toBeNull();
    printerIds.push(res.body.id);
  });

  /** §47/16.3's own Done-when: a lower-privilege role (SHOP_COUNTER,
   * lacking MANAGE_PRINTERS) is blocked from an action a higher-
   * privilege role (SHOP_MANAGER, above) can do AT THE SAME SHOP --
   * for register/update/delete, which genuinely change the printer
   * fleet. list is deliberately excluded from this permission (fixed
   * post-Phase-17, see printers.controller.ts's own comment):
   * SHOP_COUNTER needs to READ the printer list to use the "Change
   * Printer" picker on an order they're otherwise fully permitted to
   * retry (EDIT_ORDERS), so MANAGE_PRINTERS only gates writes. */
  it("register/update/delete all 403 for a SHOP_COUNTER at the same shop that a SHOP_MANAGER can act on", async () => {
    const registered = await request(app.getHttpServer())
      .post("/v1/shop/printers")
      .set("Authorization", `Bearer ${counterOnlyToken}`)
      .send({ shopId: shopA.id, name: "Should not register" });
    expect(registered.status).toBe(403);

    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, branchId: await branchIdOf(prisma, shopA.id), name: "Guarded 2" },
    });
    printerIds.push(printer.id);

    const updated = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`)
      .send({ name: "Should not rename" });
    expect(updated.status).toBe(403);

    const deleted = await request(app.getHttpServer())
      .delete(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`);
    expect(deleted.status).toBe(403);
  });

  it("list succeeds (200) for a SHOP_COUNTER at their own shop -- reading is not a MANAGE_PRINTERS action", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/printers?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterOnlyToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("register returns 403 for a shopId the caller doesn't staff", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/shop/printers")
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ shopId: shopB.id, name: "Someone Else's Printer" });
    expect(res.status).toBe(403);
  });

  it("lists only the requesting shop's own printers", async () => {
    const shopBPrinter = await prisma.printer.create({
      data: {
        shopId: shopB.id,
        branchId: await branchIdOf(prisma, shopB.id),
        name: "Shop B Printer",
      },
    });
    printerIds.push(shopBPrinter.id);

    const res = await request(app.getHttpServer())
      .get(`/v1/shop/printers?shopId=${shopA.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.every((p: { shopId: string }) => p.shopId === shopA.id)).toBe(true);
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain(shopBPrinter.id);
  });

  it("list returns 403 for a shopId the caller doesn't staff", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/shop/printers?shopId=${shopB.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(403);
  });

  it("renames a printer without touching its status", async () => {
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        branchId: await branchIdOf(prisma, shopA.id),
        name: "Old Name",
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);

    const res = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("New Name");
    expect(res.body.status).toBe("ONLINE");
  });

  it("disable always forces DISABLED; re-enable restores OFFLINE, never clobbering an agent-reported status", async () => {
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        branchId: await branchIdOf(prisma, shopA.id),
        name: "Toggle Printer",
        status: PrinterStatus.ONLINE,
      },
    });
    printerIds.push(printer.id);

    const disabled = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.status).toBe("DISABLED");

    const reEnabled = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ enabled: true });
    expect(reEnabled.status).toBe(200);
    expect(reEnabled.body.status).toBe("OFFLINE");

    // enabled: true on an already-non-disabled printer is a no-op on
    // status -- it must never clobber a real agent-reported ONLINE.
    await prisma.printer.update({
      where: { id: printer.id },
      data: { status: PrinterStatus.ONLINE },
    });
    const noOp = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({ enabled: true });
    expect(noOp.status).toBe(200);
    expect(noOp.body.status).toBe("ONLINE");
  });

  it("update rejects an empty body and a cross-shop target", async () => {
    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, branchId: await branchIdOf(prisma, shopA.id), name: "P" },
    });
    printerIds.push(printer.id);

    const empty = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`)
      .send({});
    expect(empty.status).toBe(400);

    const crossShop = await request(app.getHttpServer())
      .patch(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterBToken}`)
      .send({ name: "Hijacked" });
    expect(crossShop.status).toBe(403);
  });

  it("removes a printer with no active job", async () => {
    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, branchId: await branchIdOf(prisma, shopA.id), name: "Removable" },
    });

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(204);

    const gone = await prisma.printer.findUnique({ where: { id: printer.id } });
    expect(gone).toBeNull();
  });

  it("refuses to remove a printer with an active print job (QUEUED/CLAIMED/PRINTING/UNKNOWN)", async () => {
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Printers E2E Customer",
        email: `printers-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/printers/${randomUUID()}`,
        filename: "printers-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-PRINTERS-${randomUUID()}`,
        customerId: customer.id,
        shopId: shopA.id,
        branchId: await branchIdOf(prisma, shopA.id),
        documentId: document.id,
        printConfiguration: {},
        pricingSnapshot: {},
        orderStatus: OrderStatus.QUEUED_FOR_PRINT,
      },
    });
    const printer = await prisma.printer.create({
      data: {
        shopId: shopA.id,
        branchId: await branchIdOf(prisma, shopA.id),
        name: "Busy Printer",
      },
    });
    printerIds.push(printer.id);
    await prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId: printer.id,
        shopId: shopA.id,
        branchId: await branchIdOf(prisma, shopA.id),
        status: PrintJobStatus.PRINTING,
        idempotencyToken: randomUUID(),
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterAToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("PRINTER_HAS_ACTIVE_JOB");

    const stillThere = await prisma.printer.findUnique({ where: { id: printer.id } });
    expect(stillThere).not.toBeNull();

    await prisma.printJob.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.document.delete({ where: { id: document.id } });
    await prisma.user.delete({ where: { id: customer.id } });
  });

  it("remove returns 403 for a cross-shop target", async () => {
    const printer = await prisma.printer.create({
      data: { shopId: shopA.id, branchId: await branchIdOf(prisma, shopA.id), name: "Guarded" },
    });
    printerIds.push(printer.id);

    const res = await request(app.getHttpServer())
      .delete(`/v1/shop/printers/${printer.id}`)
      .set("Authorization", `Bearer ${counterBToken}`);
    expect(res.status).toBe(403);

    const stillThere = await prisma.printer.findUnique({ where: { id: printer.id } });
    expect(stillThere).not.toBeNull();
  });
});
