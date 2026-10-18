import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
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
import { branchIdOf } from "./helpers/branches.js";

/** 18.5's own Done-when: "a NEW test with multiItemEnabled: true and a
 * 2-item order proves two real PrintJob rows are created and correctly
 * dispatched." No API yet creates a multi-item order for real (that's
 * a later phase's UI/product-catalog work) -- this seeds the two
 * OrderItem rows directly, exactly like 15.4's own migration backfill
 * seeded the single synthetic one for every pre-existing order. */
describe("Multi-item dispatch (18.3/18.4/18.5, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let customer: { id: string; role: UserRole };
  let documentId: string;
  let shop: { id: string };
  let counter: { id: string; role: UserRole };
  let counterToken: string;
  let printerMono: { id: string };
  let printerColor: { id: string };

  const orderIds: string[] = [];
  const printerIds: string[] = [];
  const printerAgentIds: string[] = [];

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
        name: "Multi Item E2E Customer",
        email: `multi-item-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/multi-item/${randomUUID()}`,
        filename: "multi-item-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 10,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: {
        name: `Multi Item E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        // 18.3/18.5's own gate -- this suite is specifically what 18.10
        // requires before this can ever default to true anywhere else.
        multiItemEnabled: true,
      },
    });

    const agentMono = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        publicKey: "irrelevant-test-public-key",
      },
    });
    printerAgentIds.push(agentMono.id);
    printerMono = await prisma.printer.create({
      data: {
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        agentId: agentMono.id,
        name: "Multi Item Mono Printer",
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printerMono.id);

    const agentColor = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        publicKey: "irrelevant-test-public-key",
      },
    });
    printerAgentIds.push(agentColor.id);
    printerColor = await prisma.printer.create({
      data: {
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        agentId: agentColor.id,
        name: "Multi Item Color Printer",
        status: PrinterStatus.ONLINE,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    printerIds.push(printerColor.id);

    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Multi Item E2E Counter",
        email: `multi-item-e2e-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = tokenService.issueAccessToken(counter);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: printerAgentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: counter.id } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, counter.id] } } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  });

  it("a 2-item order (one mono, one colour) explodes into two real PrintJob rows, each dispatched to the compatible printer", async () => {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-MULTI-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);

    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          documentId,
          printConfiguration: {
            pages: { mode: "all" },
            copies: 1,
            paperSize: "A4",
            color: "BW",
            sides: "SINGLE",
            orientation: "PORTRAIT",
          },
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: 0,
        },
        {
          orderId: order.id,
          documentId,
          printConfiguration: {
            pages: { mode: "all" },
            copies: 1,
            paperSize: "A4",
            color: "COLOR",
            sides: "DOUBLE",
            orientation: "PORTRAIT",
          },
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: 1,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${order.id}/accept`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);

    // The order itself: two jobs both QUEUED means the derived status
    // is QUEUED_FOR_PRINT, exactly the same target a single-item order
    // reaches -- proving the derivation is item-count-agnostic.
    expect(res.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const jobs = await prisma.printJob.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
      include: { orderItem: true },
    });
    expect(jobs).toHaveLength(2);

    const monoJobFixed = jobs[0];
    const colorJobFixed = jobs[1];
    expect(monoJobFixed?.printerId).toBe(printerMono.id);
    expect(monoJobFixed?.status).toBe("QUEUED");
    expect(colorJobFixed?.printerId).toBe(printerColor.id);
    expect(colorJobFixed?.status).toBe("QUEUED");

    // idempotencyToken is `${orderItemId}:${attempt}`, a real DB
    // uniqueness guarantee (18.5) -- not a random value.
    expect(monoJobFixed?.idempotencyToken).toBe(`${monoJobFixed?.orderItemId}:1`);
    expect(colorJobFixed?.idempotencyToken).toBe(`${colorJobFixed?.orderItemId}:1`);
  });

  it("a 2-item order where only one item has a compatible printer: the compatible item is QUEUED, the other is WAITING with a blockedReason -- accept still succeeds (18.6)", async () => {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-MULTI-BLOCKED-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);

    await prisma.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          documentId,
          printConfiguration: {
            pages: { mode: "all" },
            copies: 1,
            paperSize: "A4",
            color: "BW",
            sides: "SINGLE",
            orientation: "PORTRAIT",
          },
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: 0,
        },
        {
          orderId: order.id,
          documentId,
          printConfiguration: {
            pages: { mode: "all" },
            copies: 1,
            paperSize: "A3",
            color: "BW",
            sides: "SINGLE",
            orientation: "PORTRAIT",
          },
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: 1,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/shop/orders/${order.id}/accept`)
      .set("Authorization", `Bearer ${counterToken}`)
      .expect(200);

    // aggregateOrderStatus's own precedence: a QUEUED job outranks a
    // WAITING one (rule 7 before rule 8) -- "at least one item is
    // genuinely progressing" still reads as QUEUED_FOR_PRINT, not
    // PREPARING, even while a sibling item is blocked.
    expect(res.body.orderStatus).toBe("QUEUED_FOR_PRINT");

    const jobs = await prisma.printJob.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.status).toBe("QUEUED");
    expect(jobs[0]?.printerId).not.toBeNull();
    expect(jobs[1]?.status).toBe("WAITING");
    expect(jobs[1]?.printerId).toBeNull();
    expect(jobs[1]?.blockedReason).toBe("NO_COMPATIBLE_PRINTER");

    // 18.6's own Done-when: visible via the shop-orders API response,
    // not just the database row.
    const blockedInResponse = res.body.printJobs.find(
      (job: { blockedReason: string | null }) => job.blockedReason === "NO_COMPATIBLE_PRINTER",
    );
    expect(blockedInResponse).toBeDefined();
    expect(blockedInResponse.status).toBe("WAITING");
  });
});
