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

/** 18.25c: the queue-load figures that break allocation ties must count only
 * LIVE jobs (supersededAt null) and must use ONE page measure everywhere:
 * pages a job will consume = document pageCount x item quantity (copies). */
describe("Allocation queue load (18.25c, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let customerId: string;
  const documentIds: string[] = [];
  const shopIds: string[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const printerIds: string[] = [];
  const agentIds: string[] = [];

  const config = {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Allocation Load Customer",
        email: `alloc-load-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
    userIds.push(customer.id);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId: { in: shopIds } } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  async function setup(pageCount: number) {
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/alloc-load/${randomUUID()}`,
        filename: "alloc-load.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount,
        status: DocumentStatus.READY,
      },
    });
    documentIds.push(document.id);
    const shop = await prisma.shop.create({
      data: {
        name: `Alloc Load Shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
        multiItemEnabled: true,
      },
    });
    shopIds.push(shop.id);
    const counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Alloc Load Counter",
        email: `alloc-load-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(counter.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const printers: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const agent = await prisma.printerAgent.create({
        data: { deviceId: randomUUID(), shopId: shop.id, publicKey: "irrelevant-test-public-key" },
      });
      agentIds.push(agent.id);
      const printer = await prisma.printer.create({
        data: {
          shopId: shop.id,
          agentId: agent.id,
          name: `Alloc Load Printer ${i}`,
          status: PrinterStatus.ONLINE,
          capabilities: { color: false, duplex: false, a4: true, a3: false },
          // Printer 0 is strictly the OLDEST, so it wins every exact tie.
          createdAt: new Date(Date.now() - (2 - i) * 60_000),
        },
      });
      printerIds.push(printer.id);
      printers.push(printer.id);
    }
    return {
      shopId: shop.id,
      documentId: document.id,
      printers,
      token: tokenService.issueAccessToken(counter),
    };
  }

  async function seedOrder(
    ctx: { shopId: string; documentId: string },
    quantities: number[],
    orderStatus: OrderStatus,
  ): Promise<{ orderId: string; itemIds: string[] }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-ALLOC-${randomUUID()}`,
        customerId,
        shopId: ctx.shopId,
        documentId: ctx.documentId,
        printConfiguration: config,
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const itemIds: string[] = [];
    for (const [sequence, quantity] of quantities.entries()) {
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId: ctx.documentId,
          printConfiguration: config,
          quantity,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence,
        },
      });
      itemIds.push(item.id);
    }
    return { orderId: order.id, itemIds };
  }

  async function existingJob(
    ctx: { shopId: string },
    itemId: string,
    orderId: string,
    printerId: string,
    superseded: boolean,
  ): Promise<void> {
    await prisma.printJob.create({
      data: {
        orderId,
        shopId: ctx.shopId,
        orderItemId: itemId,
        printerId,
        idempotencyToken: `${itemId}:1`,
        status: PrintJobStatus.QUEUED,
        supersededAt: superseded ? new Date() : null,
      },
    });
  }

  async function accept(orderId: string, token: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/accept`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  }

  it("a superseded QUEUED job does not count toward its printer's load (the older printer still wins the tie)", async () => {
    const ctx = await setup(10);
    // Printer 0 carries a large SUPERSEDED queued job; printer 1 is idle.
    const other = await seedOrder(ctx, [5], OrderStatus.QUEUED_FOR_PRINT);
    await existingJob(ctx, other.itemIds[0]!, other.orderId, ctx.printers[0]!, true);

    const target = await seedOrder(ctx, [1], OrderStatus.WAITING_FOR_SHOP);
    await accept(target.orderId, ctx.token);

    const job = await prisma.printJob.findFirstOrThrow({ where: { orderId: target.orderId } });
    expect(job.printerId).toBe(ctx.printers[0]);
  });

  it("the page measure is pageCount x quantity in BOTH the load query and the in-loop update", async () => {
    const ctx = await setup(1);
    // Printer 1 already has 3 live pages (1-page document x quantity 3).
    const other = await seedOrder(ctx, [3], OrderStatus.QUEUED_FOR_PRINT);
    await existingJob(ctx, other.itemIds[0]!, other.orderId, ctx.printers[1]!, false);

    // Two items of 5 pages each. Item 0 goes to printer 0 (0 < 3 live pages).
    // Correct in-loop accounting makes printer 0 carry 5, so item 1 must go
    // to printer 1 (3 < 5). Counting only pageCount (1) would leave printer
    // 0 at 1 < 3 and wrongly send item 1 to printer 0 as well.
    const target = await seedOrder(ctx, [5, 5], OrderStatus.WAITING_FOR_SHOP);
    await accept(target.orderId, ctx.token);

    const jobs = await prisma.printJob.findMany({ where: { orderId: target.orderId } });
    const byItem = new Map(jobs.map((j) => [j.orderItemId, j.printerId]));
    expect(byItem.get(target.itemIds[0]!)).toBe(ctx.printers[0]);
    expect(byItem.get(target.itemIds[1]!)).toBe(ctx.printers[1]);
  });
});
