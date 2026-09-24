import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import {
  DocumentStatus,
  OrderItemType,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  ShopStatus,
  UserRole,
  type PrintJobStatus,
  type Printer,
} from "@prisma/client";
import type { PrismaService } from "@print-automated/backend-shared";

const CONFIG = {
  pages: { mode: "all" },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

export const STALE_MS = 999_000;

/** 19.14+ worker e2e scaffolding: one private shop per suite so suites never
 * see each other's rows. Deletes are by shop/ids this fixture created only
 * (never bulk on the shared dev DB). */
export async function createSweepFixture(
  prisma: PrismaService,
  redis: Redis,
  label: string,
  opts: { autoFailoverEnabled: boolean; multiItemEnabled?: boolean },
) {
  const customer = await prisma.user.create({
    data: {
      role: UserRole.CUSTOMER,
      name: `${label} customer`,
      email: `${label}-${randomUUID()}@print-automated.dev`,
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
      pageCount: 5,
      status: DocumentStatus.READY,
    },
  });
  const shop = await prisma.shop.create({
    data: {
      name: `${label} shop ${randomUUID()}`,
      address: "1",
      status: ShopStatus.OPEN,
      multiItemEnabled: opts.multiItemEnabled ?? true,
      autoFailoverEnabled: opts.autoFailoverEnabled,
    },
  });
  const agentIds: string[] = [];
  const printerIds: string[] = [];
  const deviceIds: string[] = [];

  async function makePrinter(
    name: string,
    o: { lastSeenAgoMs?: number | null; status?: PrinterStatus } = {},
  ): Promise<{ printer: Printer; deviceId: string; agentId: string }> {
    const deviceId = randomUUID();
    const lastSeenAgoMs = o.lastSeenAgoMs === undefined ? 1000 : o.lastSeenAgoMs;
    const agent = await prisma.printerAgent.create({
      data: {
        deviceId,
        shopId: shop.id,
        publicKey: "irrelevant-test-public-key",
        lastSeenAt: lastSeenAgoMs === null ? null : new Date(Date.now() - lastSeenAgoMs),
      },
    });
    agentIds.push(agent.id);
    deviceIds.push(deviceId);
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agent.id,
        name,
        status: o.status ?? PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return { printer, deviceId, agentId: agent.id };
  }

  async function makeJob(
    printerId: string | null,
    status: PrintJobStatus,
    extra: { blockedReason?: string; orderStatus?: OrderStatus; ageMinutes?: number } = {},
  ): Promise<{ jobId: string; itemId: string; orderId: string }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-${label}-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
        documentId: document.id,
        printConfiguration: CONFIG,
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus: extra.orderStatus ?? OrderStatus.QUEUED_FOR_PRINT,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        documentId: document.id,
        printConfiguration: CONFIG,
        quantity: 1,
        itemType: OrderItemType.PRINT,
        required: true,
        sequence: 0,
      },
    });
    const job = await prisma.printJob.create({
      data: {
        orderId: order.id,
        shopId: shop.id,
        orderItemId: item.id,
        printerId,
        status,
        blockedReason: extra.blockedReason,
        idempotencyToken: `${item.id}:1`,
      },
    });
    if (extra.ageMinutes) {
      await prisma.$executeRaw`UPDATE print_jobs SET updated_at = now() - make_interval(mins => ${extra.ageMinutes}) WHERE id = ${job.id}`;
    }
    return { jobId: job.id, itemId: item.id, orderId: order.id };
  }

  const signalLength = (deviceId: string) => redis.llen(`agent-job-signal:${deviceId}`);

  async function cleanup(): Promise<void> {
    const errors: unknown[] = [];
    const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
      } catch (error) {
        errors.push(new Error(`cleanup step "${name}" failed: ${String(error)}`));
      }
    };
    const orders = await prisma.order.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    const jobs = await prisma.printJob.findMany({
      where: { shopId: shop.id },
      select: { id: true },
    });
    await step("audit_logs", () =>
      prisma.auditLog.deleteMany({
        where: {
          resourceId: {
            in: [...jobs.map((j) => j.id), ...orderIds, ...printerIds, ...agentIds, shop.id],
          },
        },
      }),
    );
    await step("print_jobs", () => prisma.printJob.deleteMany({ where: { shopId: shop.id } }));
    await step("order_items", () =>
      prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    );
    await step("notifications", () =>
      prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } }),
    );
    await step("orders", () => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
    await step("printers", () => prisma.printer.deleteMany({ where: { id: { in: printerIds } } }));
    await step("printer_agents", () =>
      prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } }),
    );
    await step("documents", () => prisma.document.deleteMany({ where: { id: document.id } }));
    await step("users", () => prisma.user.deleteMany({ where: { id: customer.id } }));
    await step("shop", () => prisma.shop.deleteMany({ where: { id: shop.id } }));
    await step("redis signals", async () => {
      if (deviceIds.length > 0) {
        await redis.del(...deviceIds.map((d) => `agent-job-signal:${d}`));
      }
    });
    if (errors.length > 0) {
      throw new AggregateError(errors, "sweep fixture cleanup had failures");
    }
  }

  return { shop, customer, makePrinter, makeJob, signalLength, cleanup };
}

export type SweepFixture = Awaited<ReturnType<typeof createSweepFixture>>;
