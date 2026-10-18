import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
  DocumentStatus,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  ShopStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { ShopOrdersService } from "../src/shop-orders/shop-orders.service.js";
import { branchIdOf } from "./helpers/branches.js";

/** 18.19: the synthetic OrderItem is created lazily by dispatchToPrinter,
 * safe today only because every caller holds the order lock. This drives
 * two first-dispatches for ONE order in two independent transactions with
 * NO order lock, so the only thing standing between them and a duplicate
 * item is the (order_id, sequence) unique index plus the tolerant create. */
describe("OrderItem uniqueness (18.19, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let service: ShopOrdersService;
  let customerId: string;
  let documentId: string;
  let shopId: string;
  let printerId: string;
  let agentId: string;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(ShopOrdersService);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Item Uniqueness Customer",
        email: `item-unique-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/item-unique/${randomUUID()}`,
        filename: "item-unique.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
    const shop = await prisma.shop.create({
      data: {
        name: `Item Uniqueness Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopId = shop.id;
    const agent = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        publicKey: "irrelevant-test-public-key",
      },
    });
    agentId = agent.id;
    const printer = await prisma.printer.create({
      data: {
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        agentId,
        name: "Item Uniqueness Printer",
        status: PrinterStatus.ONLINE,
        capabilities: { color: true, duplex: true, a4: true, a3: false },
      },
    });
    printerId = printer.id;
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-ITEMUNIQ-${randomUUID()}`,
        customerId,
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        documentId,
        printConfiguration: {
          pages: { mode: "all" },
          copies: 1,
          paperSize: "A4",
          color: "BW",
          sides: "SINGLE",
          orientation: "PORTRAIT",
        },
        pricingSnapshot: { quote: { totalMinor: 1000, currency: "PKR" } },
        orderStatus: OrderStatus.WAITING_FOR_SHOP,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    await prisma.orderItem.deleteMany({ where: { orderId } });
    await prisma.order.deleteMany({ where: { id: orderId } });
    await prisma.printer.deleteMany({ where: { id: printerId } });
    await prisma.printerAgent.deleteMany({ where: { id: agentId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: customerId } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await app.close();
  });

  it("two concurrent first-dispatches (no order lock) still yield exactly one OrderItem", async () => {
    const dispatch = (
      service as unknown as {
        dispatchToPrinter: (tx: unknown, orderId: string) => Promise<unknown>;
      }
    ).dispatchToPrinter.bind(service);

    // allSettled: the loser may also hit the job idempotency-token unique
    // index (both compute attempt 1) -- that is fine and unrelated; what
    // this test pins is the item count.
    await Promise.allSettled(
      [0, 1].map(() => prisma.$transaction(async (tx) => dispatch(tx, orderId))),
    );

    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.sequence).toBe(0);
  });

  it("the database itself refuses a second item with the same (order, sequence)", async () => {
    await expect(
      prisma.orderItem.create({
        data: {
          orderId,
          documentId,
          printConfiguration: {},
          quantity: 1,
          itemType: "PRINT",
          required: true,
          sequence: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
