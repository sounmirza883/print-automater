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

/** 18.7/18.9, e2e: manual reassignment and manual operator assignment,
 * both against real Postgres rows through the real HTTP surface. */
describe("Print jobs API (18.7/18.9, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  let customer: { id: string };
  let documentId: string;
  let shop: { id: string };
  let manager: { id: string; role: UserRole };
  let managerToken: string;
  let counter: { id: string; role: UserRole };
  let counterToken: string;
  let operator: { id: string };
  let otherShopOperator: { id: string };
  let printerA: { id: string };
  let printerB: { id: string };

  const orderIds: string[] = [];
  const printerIds: string[] = [];
  const printerAgentIds: string[] = [];
  const userIds: string[] = [];
  let otherShop: { id: string };

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
        name: "Print Jobs E2E Customer",
        email: `print-jobs-e2e-customer-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(customer.id);

    const document = await prisma.document.create({
      data: {
        ownerUserId: customer.id,
        storageKey: `test/print-jobs/${randomUUID()}`,
        filename: "print-jobs-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        status: DocumentStatus.READY,
      },
    });
    documentId = document.id;

    shop = await prisma.shop.create({
      data: { name: `Print Jobs E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    otherShop = await prisma.shop.create({
      data: {
        name: `Print Jobs E2E Other Shop ${randomUUID()}`,
        address: "2",
        status: ShopStatus.OPEN,
      },
    });

    const agentA = await prisma.printerAgent.create({
      data: { deviceId: randomUUID(), shopId: shop.id, publicKey: "irrelevant-test-public-key" },
    });
    printerAgentIds.push(agentA.id);
    printerA = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agentA.id,
        name: "Print Jobs Printer A",
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printerA.id);

    const agentB = await prisma.printerAgent.create({
      data: { deviceId: randomUUID(), shopId: shop.id, publicKey: "irrelevant-test-public-key" },
    });
    printerAgentIds.push(agentB.id);
    printerB = await prisma.printer.create({
      data: {
        shopId: shop.id,
        agentId: agentB.id,
        name: "Print Jobs Printer B",
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printerB.id);

    manager = await prisma.user.create({
      data: {
        role: UserRole.SHOP_MANAGER,
        name: "Print Jobs E2E Manager",
        email: `print-jobs-e2e-manager-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(manager.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: manager.id,
        role: UserRole.SHOP_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    managerToken = tokenService.issueAccessToken(manager);

    counter = await prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "Print Jobs E2E Counter",
        email: `print-jobs-e2e-counter-${randomUUID()}@print-automated.dev`,
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
    counterToken = tokenService.issueAccessToken(counter);

    operator = await prisma.user.create({
      data: {
        role: UserRole.OPERATOR,
        name: "Print Jobs E2E Operator",
        email: `print-jobs-e2e-operator-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(operator.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shop.id,
        userId: operator.id,
        role: UserRole.OPERATOR,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    otherShopOperator = await prisma.user.create({
      data: {
        role: UserRole.OPERATOR,
        name: "Print Jobs E2E Other Shop Operator",
        email: `print-jobs-e2e-other-operator-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(otherShopOperator.id);
    await prisma.shopStaff.create({
      data: {
        shopId: otherShop.id,
        userId: otherShopOperator.id,
        role: UserRole.OPERATOR,
        status: ShopStaffStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await prisma.printJob.deleteMany({ where: { shopId: { in: [shop.id, otherShop.id] } } });
    await prisma.orderItem.deleteMany({
      where: { order: { shopId: { in: [shop.id, otherShop.id] } } },
    });
    await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: printerAgentIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: [shop.id, otherShop.id] } } });
    await app.close();
  });

  async function seedQueuedOrderWithJob(): Promise<{
    orderId: string;
    jobId: string;
    orderItemId: string;
  }> {
    const order = await prisma.order.create({
      data: {
        publicOrderNumber: `TEST-PJ-${randomUUID()}`,
        customerId: customer.id,
        shopId: shop.id,
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
        orderStatus: OrderStatus.QUEUED_FOR_PRINT,
        paymentStatus: PaymentStatus.PAID,
      },
    });
    orderIds.push(order.id);
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        documentId,
        printConfiguration: order.printConfiguration!,
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
        printerId: printerA.id,
        idempotencyToken: `${item.id}:1`,
        status: PrintJobStatus.QUEUED,
      },
    });
    return { orderId: order.id, jobId: job.id, orderItemId: item.id };
  }

  it("§20/§80/18.7: manual reassignment supersedes the old job, creates a new one on the target printer, and audits who/when/previous printer/new printer/reason", async () => {
    const { jobId } = await seedQueuedOrderWithJob();

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reassign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ printerId: printerB.id, reason: "Printer A is jammed" })
      .expect(200);

    expect(res.body.printerId).toBe(printerB.id);
    expect(res.body.status).toBe("QUEUED");
    expect(res.body.id).not.toBe(jobId);

    const oldJob = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(oldJob.status).toBe("REASSIGNED");
    expect(oldJob.supersededAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: "print_job", resourceId: res.body.id, action: "JOB_REASSIGNED" },
    });
    expect(audit?.actorId).toBe(manager.id);
    expect(audit?.createdAt).not.toBeNull();
    expect(audit?.metadata).toMatchObject({
      previousJobId: jobId,
      previousPrinterId: printerA.id,
      newPrinterId: printerB.id,
      reason: "Printer A is jammed",
    });
  });

  it("SHOP_COUNTER (no ASSIGN_JOBS permission) is refused", async () => {
    const { jobId } = await seedQueuedOrderWithJob();

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reassign`)
      .set("Authorization", `Bearer ${counterToken}`)
      .send({ printerId: printerB.id, reason: "test" });

    expect(res.status).toBe(403);
  });

  it("§21/18.9: a job can be manually assigned to a specific shop-scoped OPERATOR", async () => {
    const { jobId } = await seedQueuedOrderWithJob();

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/assign-operator`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ operatorId: operator.id })
      .expect(200);

    expect(res.body.operatorId).toBe(operator.id);

    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.operatorId).toBe(operator.id);

    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: "print_job", resourceId: jobId, action: "JOB_OPERATOR_ASSIGNED" },
    });
    expect(audit?.actorId).toBe(manager.id);
  });

  it("assigning an operator from a DIFFERENT shop is refused", async () => {
    const { jobId } = await seedQueuedOrderWithJob();

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/assign-operator`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ operatorId: otherShopOperator.id });

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("INVALID_OPERATOR");
  });

  it("passing operatorId: null un-assigns a job's operator", async () => {
    const { jobId } = await seedQueuedOrderWithJob();
    await prisma.printJob.update({ where: { id: jobId }, data: { operatorId: operator.id } });

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/assign-operator`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ operatorId: null })
      .expect(200);

    expect(res.body.operatorId).toBeNull();
  });
});
