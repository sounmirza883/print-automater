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
import { OrderStateMachine, PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { branchIdOf } from "./helpers/branches.js";

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
      data: {
        deviceId: randomUUID(),
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        publicKey: "irrelevant-test-public-key",
      },
    });
    printerAgentIds.push(agentA.id);
    printerA = await prisma.printer.create({
      data: {
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        agentId: agentA.id,
        name: "Print Jobs Printer A",
        status: PrinterStatus.ONLINE,
        capabilities: { color: false, duplex: false, a4: true, a3: false },
      },
    });
    printerIds.push(printerA.id);

    const agentB = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        publicKey: "irrelevant-test-public-key",
      },
    });
    printerAgentIds.push(agentB.id);
    printerB = await prisma.printer.create({
      data: {
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
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
        branchId: await branchIdOf(prisma, shop.id),
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

  it("18.18: a concurrent double reassign of the same job yields one success, one clean 409, and exactly one live replacement", async () => {
    const { jobId, orderId, orderItemId } = await seedQueuedOrderWithJob();

    const responses = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/v1/print-jobs/${jobId}/reassign`)
          .set("Authorization", `Bearer ${managerToken}`)
          .send({ printerId: printerB.id, reason: "race" }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = responses.find((r) => r.status === 409)!;
    expect(loser.body.error_code).toBeDefined();
    expect(loser.status).not.toBe(500);

    const jobs = await prisma.printJob.findMany({ where: { orderItemId } });
    const live = jobs.filter((j) => j.supersededAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]!.status).toBe("QUEUED");
    expect(live[0]!.printerId).toBe(printerB.id);
    expect(live[0]!.attempt).toBe(2);
    expect(jobs).toHaveLength(2);
    expect((await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
      "REASSIGNED",
    );
    // The order still derives from a real, live job -- never stranded.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).orderStatus).toBe(
      OrderStatus.QUEUED_FOR_PRINT,
    );
  });

  async function makeTarget(overrides: {
    agent: boolean;
    status: PrinterStatus;
    capabilities?: object;
  }): Promise<string> {
    let agentId: string | null = null;
    if (overrides.agent) {
      const agent = await prisma.printerAgent.create({
        data: {
          deviceId: randomUUID(),
          shopId: shop.id,
          branchId: await branchIdOf(prisma, shop.id),
          publicKey: "irrelevant-test-public-key",
        },
      });
      printerAgentIds.push(agent.id);
      agentId = agent.id;
    }
    const printer = await prisma.printer.create({
      data: {
        shopId: shop.id,
        branchId: await branchIdOf(prisma, shop.id),
        agentId,
        name: `Print Jobs Target ${randomUUID()}`,
        status: overrides.status,
        capabilities: overrides.capabilities ?? {
          color: false,
          duplex: false,
          a4: true,
          a3: false,
        },
      },
    });
    printerIds.push(printer.id);
    return printer.id;
  }

  async function expectRejectedAndUntouched(
    jobId: string,
    orderItemId: string,
    targetPrinterId: string,
    errorCode: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reassign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ printerId: targetPrinterId, reason: "invalid target" });
    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe(errorCode);
    const jobs = await prisma.printJob.findMany({ where: { orderItemId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("QUEUED");
    expect(jobs[0]!.supersededAt).toBeNull();
  }

  it("18.18: a DISABLED target printer is rejected and the job is untouched", async () => {
    const { jobId, orderItemId } = await seedQueuedOrderWithJob();
    const target = await makeTarget({ agent: true, status: PrinterStatus.DISABLED });
    await expectRejectedAndUntouched(jobId, orderItemId, target, "PRINTER_NOT_AVAILABLE");
  });

  it("18.18: a target printer with no attached agent is rejected and the job is untouched", async () => {
    const { jobId, orderItemId } = await seedQueuedOrderWithJob();
    const target = await makeTarget({ agent: false, status: PrinterStatus.ONLINE });
    await expectRejectedAndUntouched(jobId, orderItemId, target, "PRINTER_HAS_NO_AGENT");
  });

  it("18.18: a capability-incompatible target printer is rejected and the job is untouched", async () => {
    const { jobId, orderItemId } = await seedQueuedOrderWithJob();
    const target = await makeTarget({
      agent: true,
      status: PrinterStatus.ONLINE,
      capabilities: { color: false, duplex: false, a4: false, a3: true },
    });
    await expectRejectedAndUntouched(jobId, orderItemId, target, "PRINTER_CAPABILITY_MISMATCH");
  });

  it("18.18: a successful reassign wakes the NEW device's long-poll (notify after commit)", async () => {
    const { jobId } = await seedQueuedOrderWithJob();
    const agentB = await prisma.printerAgent.findFirstOrThrow({
      where: { printers: { some: { id: printerB.id } } },
    });
    const notifySpy = jest.spyOn(AgentJobsService.prototype, "notify");
    try {
      await request(app.getHttpServer())
        .post(`/v1/print-jobs/${jobId}/reassign`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ printerId: printerB.id, reason: "wake" })
        .expect(200);
      expect(notifySpy).toHaveBeenCalledWith(agentB.deviceId);
    } finally {
      notifySpy.mockRestore();
    }
  });

  it("18.18: reassign is atomic -- a failure after the supersede rolls back the supersede AND the successor, so the item is never stranded", async () => {
    const { jobId, orderId, orderItemId } = await seedQueuedOrderWithJob();
    const original = (
      OrderStateMachine.prototype as unknown as {
        applyLocked: (...args: unknown[]) => Promise<unknown>;
      }
    ).applyLocked;
    let armed = true;
    const spy = jest
      .spyOn(OrderStateMachine.prototype as never, "applyLocked" as never)
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        if (armed && args[1] === orderId && args[2] === "SYNC_JOBS") {
          armed = false;
          return Promise.reject(new Error("transient sync failure"));
        }
        return original.apply(this, args);
      } as never);
    try {
      const failed = await request(app.getHttpServer())
        .post(`/v1/print-jobs/${jobId}/reassign`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ printerId: printerB.id, reason: "atomic" });
      expect(failed.status).toBeGreaterThanOrEqual(500);

      const jobs = await prisma.printJob.findMany({ where: { orderItemId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.id).toBe(jobId);
      expect(jobs[0]!.status).toBe("QUEUED");
      expect(jobs[0]!.supersededAt).toBeNull();

      await request(app.getHttpServer())
        .post(`/v1/print-jobs/${jobId}/reassign`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ printerId: printerB.id, reason: "atomic retry" })
        .expect(200);
      const after = await prisma.printJob.findMany({ where: { orderItemId } });
      expect(after.filter((j) => j.supersededAt === null)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("18.21a: a WAITING job with no printer can be reassigned to a real printer (previous printer null, no 500)", async () => {
    const { jobId, orderId } = await seedQueuedOrderWithJob();
    await prisma.$executeRaw`UPDATE print_jobs SET status = 'WAITING', printer_id = NULL, blocked_reason = 'NO_ONLINE_PRINTER' WHERE id = ${jobId}`;

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reassign`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ printerId: printerB.id, reason: "unblock" });
    expect(res.status).toBe(200);
    expect(res.body.printerId).toBe(printerB.id);
    const audit = await prisma.auditLog.findFirst({
      where: { resourceType: "print_job", resourceId: res.body.id, action: "JOB_REASSIGNED" },
    });
    expect(audit?.metadata).toMatchObject({ previousPrinterId: null, orderId });
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

  // 23.25: who is an operator HERE is decided by the membership role at this shop, never the
  // account-level role (16.1). An invited person usually keeps a plain CUSTOMER account.
  async function makeMember(accountRole: UserRole, shopRole: UserRole): Promise<string> {
    const user = await prisma.user.create({
      data: {
        role: accountRole,
        name: `Print Jobs E2E ${accountRole} as ${shopRole}`,
        email: `print-jobs-e2e-member-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(user.id);
    await prisma.shopStaff.create({
      data: { shopId: shop.id, userId: user.id, role: shopRole, status: ShopStaffStatus.ACTIVE },
    });
    return user.id;
  }

  it("an invited OPERATOR whose account is a plain CUSTOMER account can be assigned", async () => {
    const { jobId } = await seedQueuedOrderWithJob();
    const invitedOperator = await makeMember(UserRole.CUSTOMER, UserRole.OPERATOR);

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/assign-operator`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ operatorId: invitedOperator });

    expect(res.status).toBe(200);
    expect(res.body.operatorId).toBe(invitedOperator);
  });

  it("someone whose account says OPERATOR but who is counter staff at this shop is refused", async () => {
    const { jobId } = await seedQueuedOrderWithJob();
    const counterHere = await makeMember(UserRole.OPERATOR, UserRole.SHOP_COUNTER);

    const res = await request(app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/assign-operator`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ operatorId: counterHere });

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe("INVALID_OPERATOR");
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.operatorId).toBeNull();
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
