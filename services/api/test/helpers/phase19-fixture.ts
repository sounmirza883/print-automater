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

/** 19.10: e2e that assert on "today's" usage period must not straddle 00:00
 * UTC (a row seeded at 23:59:59 would land in the previous period by the time
 * production reads the clock). If we are within `windowMs` of the next UTC
 * midnight, wait until just after it. Call from beforeAll/beforeEach. */
export async function clearOfUtcMidnight(windowMs = 90_000): Promise<void> {
  const now = Date.now();
  const nextMidnight = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;
  if (nextMidnight - now < windowMs) {
    await new Promise((resolve) => setTimeout(resolve, nextMidnight - now + 1_000));
  }
}

/** Phase 19 e2e scaffolding. Each suite gets its own shop, so suites never
 * see each other's printers. Every id is recorded AS IT IS CREATED, so if
 * creation throws midway the partial state is cleaned up here before the
 * error propagates (the caller's `fx` would be undefined). `cleanup()` runs
 * EVERY step even when one throws, always closes the app, and rethrows the
 * collected errors at the end. Targeted deletes only, never bulk. */
export async function createPhase19Fixture(
  label: string,
  opts: {
    multiItemEnabled: boolean;
    autoFailoverEnabled?: boolean;
    documentPages?: number | null;
  },
) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<ApiEnv>(API_ENV));
  await app.init();
  const prisma = app.get(PrismaService);
  const tokens = app.get(TokenService);

  const reg = {
    userIds: [] as string[],
    documentIds: [] as string[],
    shopId: undefined as string | undefined,
    printerIds: [] as string[],
    agentIds: [] as string[],
    orderIds: [] as string[],
  };

  /** Steps are (name, fn) so a failure can be attributed and tests can prove
   * that later steps still run. */
  async function cleanup(): Promise<void> {
    const errors: unknown[] = [];
    const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        errors.push(new Error(`cleanup step "${name}" failed: ${String(error)}`));
      }
    };
    const shopId = reg.shopId;
    try {
      // Orders/jobs are looked up by shop too: product code (retries,
      // failover) can create rows this fixture never saw.
      const shopOrders = shopId
        ? await prisma.order.findMany({ where: { shopId }, select: { id: true } })
        : [];
      const orderIds = [...new Set([...reg.orderIds, ...shopOrders.map((o) => o.id)])];
      const jobs = shopId
        ? await prisma.printJob.findMany({ where: { shopId }, select: { id: true } })
        : [];
      const resourceIds = [
        ...jobs.map((j) => j.id),
        ...reg.printerIds,
        ...reg.agentIds,
        ...orderIds,
        ...(shopId ? [shopId] : []),
        ...reg.documentIds,
      ];
      await step("audit_logs", () =>
        prisma.auditLog.deleteMany({
          where: { OR: [{ resourceId: { in: resourceIds } }, { actorId: { in: reg.userIds } }] },
        }),
      );
      await step("print_job_reprints", () =>
        prisma.printJobReprint.deleteMany({ where: { orderId: { in: orderIds } } }),
      );
      await step("print_jobs", () =>
        prisma.printJob.deleteMany({ where: { orderId: { in: orderIds } } }),
      );
      await step("refunds", () =>
        prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }),
      );
      await step("payments", () =>
        prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
      );
      await step("order_items", () =>
        prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
      );
      // notifications.user_id and .order_id are both RESTRICT.
      await step("notifications", () =>
        prisma.notification.deleteMany({
          where: { OR: [{ orderId: { in: orderIds } }, { userId: { in: reg.userIds } }] },
        }),
      );
      await step("orders", () => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
      await step("printers", () =>
        prisma.printer.deleteMany({ where: { id: { in: reg.printerIds } } }),
      );
      await step("agent_pairing_codes", () =>
        prisma.agentPairingCode.deleteMany({ where: shopId ? { shopId } : { id: "none" } }),
      );
      await step("printer_agents", () =>
        prisma.printerAgent.deleteMany({ where: { id: { in: reg.agentIds } } }),
      );
      await step("shop_staff", () =>
        prisma.shopStaff.deleteMany({ where: { userId: { in: reg.userIds } } }),
      );
      await step("documents", () =>
        prisma.document.deleteMany({ where: { id: { in: reg.documentIds } } }),
      );
      await step("users", () => prisma.user.deleteMany({ where: { id: { in: reg.userIds } } }));
      await step("shop", () =>
        prisma.shop.deleteMany({ where: shopId ? { id: shopId } : { id: "none" } }),
      );
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await app.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Phase 19 fixture cleanup had failures");
    }
  }

  try {
    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: `${label} customer`,
        email: `${label}-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    reg.userIds.push(customer.id);
    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/${label}/${randomUUID()}`,
        filename: `${label}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: opts.documentPages === undefined ? 5 : opts.documentPages,
        status: DocumentStatus.READY,
      },
    });
    reg.documentIds.push(document.id);
    const shop = await prisma.shop.create({
      data: {
        name: `${label} shop ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
        multiItemEnabled: opts.multiItemEnabled,
        autoFailoverEnabled: opts.autoFailoverEnabled ?? false,
      },
    });
    reg.shopId = shop.id;
    const owner = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: `${label} owner`,
        email: `${label}-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    reg.userIds.push(owner.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: owner.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const token = tokens.issueAccessToken(owner);

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
      reg.agentIds.push(agent.id);
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
      reg.printerIds.push(printer.id);
      return { printer, deviceId };
    }

    async function makeOrder(
      items: number,
      quantity = 1,
      orderStatus: OrderStatus = OrderStatus.WAITING_FOR_SHOP,
      config: Record<string, unknown> = CONFIG,
    ): Promise<{ orderId: string; itemIds: string[] }> {
      const order = await prisma.order.create({
        data: {
          publicOrderNumber: `TEST-${label}-${randomUUID()}`,
          customerId: customer.id,
          shopId: shop.id,
          documentId: document.id,
          printConfiguration: config as object,
          pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
          orderStatus,
          paymentStatus: PaymentStatus.PAID,
        },
      });
      reg.orderIds.push(order.id);
      const itemIds: string[] = [];
      for (let i = 0; i < items; i += 1) {
        const item = await prisma.orderItem.create({
          data: {
            orderId: order.id,
            documentId: document.id,
            printConfiguration: config as object,
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

    return {
      app,
      prisma,
      shop,
      owner,
      customer,
      token,
      makePrinter,
      makeOrder,
      cleanup,
      printerIds: reg.printerIds,
      orderIds: reg.orderIds,
      userIds: reg.userIds,
    };
  } catch (error) {
    // Creation failed midway: clean up whatever was recorded, then surface
    // the ORIGINAL error.
    await cleanup().catch(() => undefined);
    throw error;
  }
}

export type Phase19Fixture = Awaited<ReturnType<typeof createPhase19Fixture>>;
