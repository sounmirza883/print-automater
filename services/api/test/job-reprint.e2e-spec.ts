import { randomUUID } from "node:crypto";
import { OrderStatus, PrinterStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

type JobStatus = "PRINTED" | "QUEUED" | "FAILED" | "UNKNOWN" | "PAUSED" | "WAITING";

/** 21.4 (PRD 67): reprint. Real Postgres, real HTTP. A reprint is a NEW job that
 * references the original; the original is never touched; it cannot be
 * triggered twice for the same job. */
describe("Job reprint (21.4, e2e)", () => {
  let fx: Fx;
  let other: Fx;
  let printerId: string;
  let deviceId: string;
  let operatorToken: string;
  let counterToken: string;
  let managerId: string;

  async function staff(f: Fx, role: UserRole): Promise<{ id: string; token: string }> {
    const user = await f.prisma.user.create({
      data: {
        role,
        name: `reprint ${role}`,
        email: `reprint-${role}-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    f.userIds.push(user.id);
    await f.prisma.shopStaff.create({
      data: { shopId: f.shop.id, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
    });
    return { id: user.id, token: f.app.get(TokenService).issueAccessToken(user) };
  }

  beforeAll(async () => {
    fx = await createPhase19Fixture("reprint", { multiItemEnabled: true });
    other = await createPhase19Fixture("reprint-other", { multiItemEnabled: true });
    const printer = await fx.makePrinter("RP-A");
    printerId = printer.printer.id;
    deviceId = printer.deviceId;
    operatorToken = (await staff(fx, UserRole.OPERATOR)).token;
    counterToken = (await staff(fx, UserRole.SHOP_COUNTER)).token;
    managerId = (await staff(fx, UserRole.SHOP_MANAGER)).id;
  });
  afterAll(async () => {
    await other?.cleanup();
    await fx?.cleanup();
  });

  const job = (id: string) => fx.prisma.printJob.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => fx.prisma.order.findUniqueOrThrow({ where: { id } });
  const reprintRows = (originalJobId: string) =>
    fx.prisma.printJobReprint.findMany({ where: { originalJobId } });
  const reprint = (
    jobId: string,
    body: object,
    token = fx.token,
    headers: Record<string, string> = {},
  ) =>
    request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reprint`)
      .set("Authorization", `Bearer ${token}`)
      .set(headers)
      .send(body);

  async function seed(status: JobStatus, orderStatus: OrderStatus = OrderStatus.PRINTED) {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, orderStatus);
    const j = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId: status === "WAITING" || status === "PAUSED" ? null : printerId,
        status,
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return { jobId: j.id, orderId, itemId: itemIds[0]! };
  }

  it("creates a NEW job through the allocation path that references the original; records reason, user, time and cost; leaves the original and the order's price untouched", async () => {
    const s = await seed("PRINTED");
    const originalBefore = await job(s.jobId);
    const orderBefore = await order(s.orderId);

    const res = await reprint(s.jobId, {
      reason: "POOR_QUALITY",
      note: "banding on page 2",
      additionalCostMinor: 250,
    }).expect(200);
    expect(res.body).toMatchObject({
      originalJobId: s.jobId,
      reason: "POOR_QUALITY",
      additionalCostMinor: 250,
      job: { status: "QUEUED", printerId, attempt: 2 },
    });
    const newJobId = res.body.job.id as string;
    expect(newJobId).not.toBe(s.jobId);

    const created = await job(newJobId);
    expect(created).toMatchObject({ orderItemId: s.itemId, attempt: 2, status: "QUEUED" });
    expect(created.idempotencyToken).toBe(`${s.itemId}:2`);

    // the original is not mutated in any way
    expect(await job(s.jobId)).toEqual(originalBefore);
    // ... and neither is what the customer paid
    const orderAfter = await order(s.orderId);
    expect(orderAfter.pricingSnapshot).toEqual(orderBefore.pricingSnapshot);
    expect(orderAfter.paymentStatus).toBe(orderBefore.paymentStatus);
    expect(orderAfter.orderStatus).toBe(OrderStatus.PRINTING);

    const [row] = await reprintRows(s.jobId);
    expect(row).toMatchObject({
      reprintJobId: newJobId,
      reason: "POOR_QUALITY",
      note: "banding on page 2",
      additionalCostMinor: 250,
      requestedBy: fx.owner.id,
      orderId: s.orderId,
      shopId: fx.shop.id,
      source: "STAFF",
    });
    expect(row!.createdAt).toBeInstanceOf(Date);
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: newJobId, action: "JOB_REPRINT_CREATED" },
    });
    expect(audit?.actorId).toBe(fx.owner.id);
    expect(audit?.metadata).toMatchObject({
      originalJobId: s.jobId,
      reason: "POOR_QUALITY",
      additionalCostMinor: 250,
    });

    // it is a normal job: the agent prints it and the order settles back to PRINTED
    const agent = fx.app.get(AgentJobsService);
    await agent.claim(newJobId, deviceId);
    await agent.reportStatus(newJobId, deviceId, { status: "PRINTING" });
    await agent.reportStatus(newJobId, deviceId, { status: "PRINTED" });
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PRINTED);
  });

  it("defaults the cost to 0 and works on an order already READY_FOR_COLLECTION (status not resurrected)", async () => {
    const s = await seed("PRINTED", OrderStatus.READY_FOR_COLLECTION);
    const res = await reprint(s.jobId, { reason: "CUSTOMER_REQUEST" }).expect(200);
    expect(res.body.additionalCostMinor).toBe(0);
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);
  });

  it.each(["QUEUED", "FAILED", "UNKNOWN", "PAUSED", "WAITING"] as const)(
    "never reprints a %s job (only a settled PRINTED job): 409 REPRINT_JOB_INVALID, nothing created",
    async (status) => {
      const s = await seed(status, OrderStatus.PRINT_FAILED);
      const res = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(409);
      expect(res.body.error_code).toBe("REPRINT_JOB_INVALID");
      expect(await fx.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(1);
      expect(await reprintRows(s.jobId)).toHaveLength(0);
    },
  );

  it("cannot be double-triggered: concurrent requests for one job yield exactly one 200, clean 409s, one reprint row and one new job", async () => {
    const s = await seed("PRINTED");
    const responses = await Promise.all(
      [0, 1, 2, 3].map(() => reprint(s.jobId, { reason: "PAPER_JAM" })),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(["REPRINT_ALREADY_EXISTS", "REPRINT_ITEM_IN_PROGRESS"]).toContain(r.body.error_code);
    }
    expect(await reprintRows(s.jobId)).toHaveLength(1);
    expect(await fx.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(2);
  });

  it("a second reprint of the same job is refused, before and after the first reprint prints; the reprint itself can be reprinted (a chain)", async () => {
    const s = await seed("PRINTED");
    const first = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(200);
    const firstJobId = first.body.job.id as string;
    const during = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(409);
    expect(["REPRINT_ALREADY_EXISTS", "REPRINT_ITEM_IN_PROGRESS"]).toContain(
      during.body.error_code,
    );

    const agent = fx.app.get(AgentJobsService);
    await agent.claim(firstJobId, deviceId);
    await agent.reportStatus(firstJobId, deviceId, { status: "PRINTING" });
    await agent.reportStatus(firstJobId, deviceId, { status: "PRINTED" });

    const after = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(409);
    expect(after.body.error_code).toBe("REPRINT_ALREADY_EXISTS");
    const chained = await reprint(firstJobId, { reason: "POOR_QUALITY" }).expect(200);
    expect(chained.body.job.attempt).toBe(3);
    expect(await reprintRows(s.jobId)).toHaveLength(1);
    expect(await reprintRows(firstJobId)).toHaveLength(1);
  });

  it("refuses while another attempt for the same item is still in progress (never two copies in flight)", async () => {
    const s = await seed("PRINTED");
    await fx.prisma.printJob.create({
      data: {
        orderId: s.orderId,
        shopId: fx.shop.id,
        orderItemId: s.itemId,
        printerId,
        status: "QUEUED",
        attempt: 2,
        idempotencyToken: `${s.itemId}:2`,
      },
    });
    const res = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(409);
    expect(res.body.error_code).toBe("REPRINT_ITEM_IN_PROGRESS");
    expect(await reprintRows(s.jobId)).toHaveLength(0);
  });

  it("is replay-safe under an Idempotency-Key: the same key returns the first result and creates nothing more", async () => {
    const s = await seed("PRINTED");
    const key = randomUUID();
    const a = await reprint(s.jobId, { reason: "WRONG_PAPER" }, fx.token, {
      "Idempotency-Key": key,
    }).expect(200);
    const b = await reprint(s.jobId, { reason: "WRONG_PAPER" }, fx.token, {
      "Idempotency-Key": key,
    }).expect(200);
    expect(b.body).toEqual(a.body);
    expect(await reprintRows(s.jobId)).toHaveLength(1);
    expect(await fx.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(2);
  });

  it("refuses a closed order (COMPLETED) with 409 ORDER_NOT_REPRINTABLE", async () => {
    const s = await seed("PRINTED", OrderStatus.COMPLETED);
    const res = await reprint(s.jobId, { reason: "POOR_QUALITY" }).expect(409);
    expect(res.body.error_code).toBe("ORDER_NOT_REPRINTABLE");
    expect(await reprintRows(s.jobId)).toHaveLength(0);
  });

  it("validates the body: a reason from the picker is required, cost is a non-negative whole number", async () => {
    const s = await seed("PRINTED");
    await reprint(s.jobId, {}).expect(400);
    await reprint(s.jobId, { reason: "BECAUSE" }).expect(400);
    await reprint(s.jobId, { reason: "OTHER", additionalCostMinor: -1 }).expect(400);
    await reprint(s.jobId, { reason: "OTHER", additionalCostMinor: 1.5 }).expect(400);
    expect(await reprintRows(s.jobId)).toHaveLength(0);
  });

  it("REPRINT_JOBS is a manager/owner/printer-manager permission: OPERATOR and SHOP_COUNTER get 403, another shop is denied, unauthenticated is 401", async () => {
    const s = await seed("PRINTED");
    await reprint(s.jobId, { reason: "POOR_QUALITY" }, operatorToken).expect(403);
    await reprint(s.jobId, { reason: "POOR_QUALITY" }, counterToken).expect(403);
    const denied = await reprint(s.jobId, { reason: "POOR_QUALITY" }, other.token);
    expect([403, 404]).toContain(denied.status);
    await request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${s.jobId}/reprint`)
      .send({ reason: "POOR_QUALITY" })
      .expect(401);
    expect(await reprintRows(s.jobId)).toHaveLength(0);
    expect(managerId).toBeTruthy();
  });

  it("the shop order detail shows which job is a reprint of which, with reason and cost", async () => {
    const s = await seed("PRINTED");
    const res = await reprint(s.jobId, { reason: "INK_TONER", additionalCostMinor: 100 }).expect(
      200,
    );
    const detail = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${s.orderId}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    const summary = detail.body.printJobs.find((j: { id: string }) => j.id === res.body.job.id);
    expect(summary.reprint).toMatchObject({
      originalJobId: s.jobId,
      reason: "INK_TONER",
      additionalCostMinor: 100,
    });
    const originalSummary = detail.body.printJobs.find((j: { id: string }) => j.id === s.jobId);
    expect(originalSummary.reprint).toBeNull();
  });
});

/** No printer available right now. */
describe("Job reprint with no usable printer (21.4, e2e)", () => {
  let multi: Fx;
  let single: Fx;
  beforeAll(async () => {
    multi = await createPhase19Fixture("reprint-none-multi", { multiItemEnabled: true });
    single = await createPhase19Fixture("reprint-none-single", { multiItemEnabled: false });
    await multi.makePrinter("off", { status: PrinterStatus.OFFLINE });
    await single.makePrinter("off", { status: PrinterStatus.OFFLINE });
  });
  afterAll(async () => {
    await single?.cleanup();
    await multi?.cleanup();
  });

  async function seedPrinted(f: Fx) {
    const { orderId, itemIds } = await f.makeOrder(1, 1, OrderStatus.PRINTED);
    const j = await f.prisma.printJob.create({
      data: {
        orderId,
        shopId: f.shop.id,
        orderItemId: itemIds[0]!,
        status: "PRINTED",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return { jobId: j.id, orderId };
  }
  const post = (f: Fx, jobId: string) =>
    request(f.app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/reprint`)
      .set("Authorization", `Bearer ${f.token}`)
      .send({ reason: "POOR_QUALITY" });

  it("multi-item shop: the reprint job waits (WAITING with the allocation's reason) rather than failing", async () => {
    const s = await seedPrinted(multi);
    const res = await post(multi, s.jobId).expect(200);
    expect(res.body.job).toMatchObject({ status: "WAITING", printerId: null });
    expect(res.body.job.blockedReason).not.toBeNull();
  });

  it("single-item shop: same refusal the retry path gives (409 NO_PRINTER_AVAILABLE) and the whole reprint rolls back", async () => {
    const s = await seedPrinted(single);
    const res = await post(single, s.jobId).expect(409);
    expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
    expect(await single.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(1);
    expect(await single.prisma.printJobReprint.count({ where: { originalJobId: s.jobId } })).toBe(
      0,
    );
  });
});
