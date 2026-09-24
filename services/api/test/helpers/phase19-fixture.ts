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
  type Printer,
} from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../../src/app.module.js";
import { TokenService } from "../../src/auth/token.service.js";
import { API_ENV } from "../../src/config/config.module.js";
import { configureApp } from "../../src/bootstrap.js";

const CONFIG = {
  pages: { mode: "all" },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

/** Phase 19 e2e scaffolding. Each suite gets its own shop, so suites never
 * see each other's printers. Everything created here is deleted by
 * `cleanup()` (targeted deletes only, never bulk). */
export async function createPhase19Fixture(
  label: string,
  opts: { multiItemEnabled: boolean; autoFailoverEnabled?: boolean; documentPages?: number },
) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<ApiEnv>(API_ENV));
  await app.init();
  const prisma = app.get(PrismaService);
  const tokens = app.get(TokenService);

  const customer = await prisma.user.create({
    data: {
      role: UserRole.CUSTOMER,
      name: `${label} customer`,
      email: `${label}-customer-${randomUUID()}@print-automated.dev`,
      passwordHash: "irrelevant",
    },
  });
  const document = await prisma.document.create({
    data: {
      ownerUserId: customer.id,
      storageKey: `test/${label}/${randomUUID()}`,
      filename: `${label}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      pageCount: opts.documentPages ?? 5,
      status: DocumentStatus.READY,
    },
  });
  const shop = await prisma.shop.create({
    data: {
      name: `${label} shop ${randomUUID()}`,
      address: "1",
      status: ShopStatus.OPEN,
      multiItemEnabled: opts.multiItemEnabled,
      autoFailoverEnabled: opts.autoFailoverEnabled ?? false,
    },
  });
  const owner = await prisma.user.create({
    data: {
      role: UserRole.SHOP_OWNER,
      name: `${label} owner`,
      email: `${label}-owner-${randomUUID()}@print-automated.dev`,
      passwordHash: "irrelevant",
    },
  });
  await prisma.shopStaff.create({
    data: {
      shopId: shop.id,
      userId: owner.id,
      role: UserRole.SHOP_OWNER,
      status: ShopStaffStatus.ACTIVE,
    },
  });
  const token = tokens.issueAccessToken(owner);

  const printerIds: string[] = [];
  const agentIds: string[] = [];
  const orderIds: string[] = [];

  async function makePrinter(
    name: string,
    data: Partial<
      Pick<Printer, "pageLimit" | "pageLimitEnabled" | "pageLimitPeriod" | "status">
    > = {},
  ): Promise<{ printer: Printer; deviceId: string }> {
    const deviceId = randomUUID();
    const agent = await prisma.printerAgent.create({
      data: { deviceId, shopId: shop.id, publicKey: "irrelevant-test-public-key" },
    });
    agentIds.push(agent.id);
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agent.id,
        name,
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
        ...data,
      },
    });
    printerIds.push(printer.id);
    return { printer, deviceId };
  }

  async function makeOrder(
    items: number,
    quantity = 1,
    orderStatus: OrderStatus = OrderStatus.WAITING_FOR_SHOP,
  ): Promise<{ orderId: string; itemIds: string[] }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-${label}-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        documentId: document.id,
        printConfiguration: CONFIG,
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const itemIds: string[] = [];
    for (let i = 0; i < items; i += 1) {
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId: document.id,
          printConfiguration: CONFIG,
          quantity,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: i,
        },
      });
      itemIds.push(item.id);
    }
    return { orderId: order.id, itemIds };
  }

  async function cleanup(): Promise<void> {
    const jobs = await prisma.printJob.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });
    const jobIds = jobs.map((j) => j.id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { resourceId: { in: [...jobIds, ...printerIds, ...orderIds] } },
          { actorId: owner.id },
        ],
      },
    });
    await prisma.printJob.deleteMany({ where: { shopId: shop.id } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId: shop.id } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: owner.id } });
    await prisma.document.deleteMany({ where: { id: document.id } });
    await prisma.user.deleteMany({ where: { id: { in: [customer.id, owner.id] } } });
    await prisma.shop.deleteMany({ where: { id: shop.id } });
    await app.close();
  }

  return { app, prisma, shop, owner, token, makePrinter, makeOrder, cleanup, printerIds, orderIds };
}

export type Phase19Fixture = Awaited<ReturnType<typeof createPhase19Fixture>>;
