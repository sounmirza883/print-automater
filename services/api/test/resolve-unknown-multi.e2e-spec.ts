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

/** 18.26: resolve-unknown on a multi-item order. With 2+ UNKNOWN jobs an explicit
 * jobId is required (each may have a different real-world outcome), the
 * precondition is re-checked under the order lock, nothing-resolved is never a
 * 200, and RETRY is audited through the job machine. */
describe("Resolve-unknown on multi-item orders (18.26, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let customerId: string;
  let counterId: string;
  let documentId: string;
  let shopId: string;
  let counterToken: string;
  let printerA: { id: string };
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

  async function makePrinter(name: string): Promise<{ id: string }> {
    const agent = await prisma.printerAgent.create({
      data: { deviceId: randomUUID(), shopId, publicKey: "irrelevant-test-public-key" },
    });
    agentIds.push(agent.id);
    const printer = await prisma.printer.create({
      data: {
        shopId,
        agentId: agent.id,
        name,
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printer.id);
    return printer;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);

    const customer = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Resolve Unknown Customer",
        email: `resolve-unknown-multi-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    customerId = customer.id;
    const document = await prisma.document.create({
      data: {
        ownerUserId: customerId,
        storageKey: `test/resolve-unknown-multi/${randomUUID()}`,
        filename: "resolve-unknown-multi.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        pageCount: 3,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;
    const shop = await prisma.shop.create({
      data: {
        name: `Resolve Unknown Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
        multiItemEnabled: true,
      },
    });
    shopId = shop.id;
    printerA = await makePrinter("Retry Printer A");
    await makePrinter("Retry Printer B");

    const counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Resolve Unknown Counter",
        email: `resolve-unknown-multi-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    counterId = counter.id;
    await prisma.shopStaff.create({
      data: {
        shopId,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = app.get(TokenService).issueAccessToken(counter);
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId } });
    await prisma.orderItem.deleteMany({ where: { order: { shopId } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.auditLog.deleteMany({
      where: { resourceType: "order", resourceId: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: counterId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerId, counterId] } } });
    await prisma.shop.deleteMany({ where: { id: shopId } });
    await app.close();
  });

  async function seed(
    orderStatus: OrderStatus,
    statuses: [PrintJobStatus, PrintJobStatus, PrintJobStatus],
  ): Promise<{ orderId: string; itemIds: string[]; jobIds: string[] }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-RESUNK-${randomUUID()}`,
        customerId,
        shopId,
        documentId,
        printConfiguration: config,
        pricingSnapshot: { quote: { totalMinor: 3000, currency: "PKR" } },
        orderStatus,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const itemIds: string[] = [];
    const jobIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id,
          documentId,
          printConfiguration: config,
          quantity: 1,
          itemType: OrderItemType.PRINT,
          required: true,
          sequence: i,
        },
      });
      itemIds.push(item.id);
      const job = await prisma.printJob.create({
        data: {
          orderId: order.id,
          shopId,
          orderItemId: item.id,
          printerId: printerA.id,
          idempotencyToken: `${item.id}:1`,
          status: statuses[i]!,
        },
      });
      jobIds.push(job.id);
    }
    return { orderId: order.id, itemIds, jobIds };
  }

  const resolve = (orderId: string, body: object) =>
    request(app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${counterToken}`)
      .send(body);
  const statusOf = async (jobId: string) =>
    (await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } })).status;

  it("2 UNKNOWN jobs and no jobId -> 409 listing the UNKNOWN ids, nothing changed", async () => {
    const { orderId, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
      PrintJobStatus.UNKNOWN,
    ]);
    const res = await resolve(orderId, { resolution: "CONFIRMED_PRINTED" });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("UNKNOWN_JOB_ID_REQUIRED");
    expect(res.body.message).toContain(jobIds[1]);
    expect(res.body.message).toContain(jobIds[2]);
    expect(await statusOf(jobIds[1]!)).toBe(PrintJobStatus.UNKNOWN);
    expect(await statusOf(jobIds[2]!)).toBe(PrintJobStatus.UNKNOWN);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
      OrderStatus.PRINT_STATUS_UNKNOWN,
    );
  });

  it("with jobId only that job resolves; the order stays PRINT_STATUS_UNKNOWN until the second is resolved", async () => {
    const { orderId, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
      PrintJobStatus.UNKNOWN,
    ]);
    const first = await resolve(orderId, { resolution: "CONFIRMED_PRINTED", jobId: jobIds[1] });
    expect(first.status).toBe(200);
    expect(first.body.orderStatus).toBe(OrderStatus.PRINT_STATUS_UNKNOWN);
    expect(await statusOf(jobIds[1]!)).toBe(PrintJobStatus.PRINTED);
    expect(await statusOf(jobIds[2]!)).toBe(PrintJobStatus.UNKNOWN);

    const second = await resolve(orderId, { resolution: "CONFIRMED_PRINTED", jobId: jobIds[2] });
    expect(second.status).toBe(200);
    expect(second.body.orderStatus).toBe(OrderStatus.PRINTED);
  });

  it("a jobId that is not one of the order's UNKNOWN jobs is refused", async () => {
    const { orderId, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
      PrintJobStatus.UNKNOWN,
    ]);
    const res = await resolve(orderId, { resolution: "MARK_FAILED", jobId: jobIds[0] });
    expect(res.status).toBe(409);
    expect(await statusOf(jobIds[0]!)).toBe(PrintJobStatus.PRINTED);
  });

  it("concurrent double-resolve of a single-UNKNOWN order: exactly one 200 and one 409, never a 200 that did nothing", async () => {
    const { orderId, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
    ]);
    const responses = await Promise.all(
      [0, 1].map(() => resolve(orderId, { resolution: "CONFIRMED_PRINTED" })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.body.error_code).toBe(
      "ILLEGAL_ORDER_TRANSITION",
    );
    expect(await statusOf(jobIds[2]!)).toBe(PrintJobStatus.PRINTED);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
      OrderStatus.PRINTED,
    );
  });

  it("an order in PRINT_STATUS_UNKNOWN with no UNKNOWN job left is a 409, not a silent 200", async () => {
    const { orderId } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.PRINTED,
      PrintJobStatus.PRINTED,
    ]);
    for (const resolution of ["CONFIRMED_PRINTED", "MARK_FAILED", "RETRY"]) {
      const res = await resolve(orderId, { resolution });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");
    }
  });

  it("RETRY is audited through the job machine with the actor and resolution, supersedes only that job and re-dispatches only its item", async () => {
    const { orderId, itemIds, jobIds } = await seed(OrderStatus.PRINT_STATUS_UNKNOWN, [
      PrintJobStatus.PRINTED,
      PrintJobStatus.UNKNOWN,
      PrintJobStatus.PRINTING,
    ]);
    const res = await resolve(orderId, { resolution: "RETRY" });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findMany({
      where: { resourceType: "print_job", resourceId: jobIds[1] },
    });
    const retryAudit = audit.filter((a) => a.action === "PRINT_JOB_RESOLVE_RETRY");
    expect(retryAudit).toHaveLength(1);
    expect(retryAudit[0]!.actorId).toBe(counterId);
    expect(retryAudit[0]!.metadata).toMatchObject({
      resolution: "RETRY",
      from: "UNKNOWN",
      orderId,
    });

    const all = await prisma.printJob.findMany({ where: { orderId } });
    expect(all.filter((j) => !jobIds.includes(j.id))).toHaveLength(1);
    expect(all.find((j) => !jobIds.includes(j.id))!.orderItemId).toBe(itemIds[1]);
    expect(all.find((j) => j.id === jobIds[1])!.supersededAt).not.toBeNull();
    expect(await statusOf(jobIds[0]!)).toBe(PrintJobStatus.PRINTED);
    expect(await statusOf(jobIds[2]!)).toBe(PrintJobStatus.PRINTING);
  });
});
