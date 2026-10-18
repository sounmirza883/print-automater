import { randomUUID } from "node:crypto";
import { OrderStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

type JobStatus = "FAILED" | "TIMEOUT" | "UNKNOWN" | "QUEUED" | "PRINTED";

/** 21.2 (PRD 66): the operator picks a failure reason; the system records it. */
describe("Job failure reasons (21.2, e2e)", () => {
  let fx: Fx;
  let other: Fx;
  let printerId: string;
  let counterToken: string;

  beforeAll(async () => {
    fx = await createPhase19Fixture("fail-reason", { multiItemEnabled: true });
    other = await createPhase19Fixture("fail-reason-other", { multiItemEnabled: true });
    printerId = (await fx.makePrinter("FR-A")).printer.id;
    const counter = await fx.prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "fr counter",
        email: `fr-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    fx.userIds.push(counter.id);
    await fx.prisma.shopStaff.create({
      data: {
        shopId: fx.shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = fx.app.get(TokenService).issueAccessToken(counter);
  });
  afterAll(async () => {
    await other?.cleanup();
    await fx?.cleanup();
  });

  const job = (id: string) => fx.prisma.printJob.findUniqueOrThrow({ where: { id } });
  const record = (jobId: string, body: object, token = fx.token) =>
    request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/failure-reason`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  async function seed(status: JobStatus, orderStatus: OrderStatus = OrderStatus.PRINT_FAILED) {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, orderStatus);
    const j = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        orderItemId: itemIds[0]!,
        printerId,
        status,
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return { jobId: j.id, orderId };
  }

  it("records the picked reason and note on a FAILED job, audited with the actor", async () => {
    const s = await seed("FAILED");
    const res = await record(s.jobId, { reason: "PAPER_JAM", note: "tray 2" }).expect(200);
    expect(res.body).toMatchObject({ id: s.jobId, status: "FAILED", failureReason: "PAPER_JAM" });
    const row = await job(s.jobId);
    expect(row.failureReason).toBe("PAPER_JAM");
    expect(row.failureNote).toBe("tray 2");
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: s.jobId, action: "JOB_FAILURE_REASON_RECORDED" },
    });
    expect(audit?.actorId).toBe(fx.owner.id);
    expect(audit?.metadata).toMatchObject({ reason: "PAPER_JAM", previousReason: null });
    // the status itself is untouched
    expect(row.status).toBe("FAILED");
  });

  it("also works on a TIMEOUT job, and a later pick replaces the earlier one (previous reason audited)", async () => {
    const s = await seed("TIMEOUT");
    await record(s.jobId, { reason: "PRINTER_ERROR" }).expect(200);
    await record(s.jobId, { reason: "HARDWARE" }).expect(200);
    expect((await job(s.jobId)).failureReason).toBe("HARDWARE");
    const audits = await fx.prisma.auditLog.findMany({
      where: { resourceId: s.jobId, action: "JOB_FAILURE_REASON_RECORDED" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[1]!.metadata).toMatchObject({
      reason: "HARDWARE",
      previousReason: "PRINTER_ERROR",
    });
  });

  it.each(["QUEUED", "PRINTED", "UNKNOWN"] as const)(
    "refuses a %s job with 409 JOB_NOT_FAILED and records nothing",
    async (status) => {
      const s = await seed(status, OrderStatus.QUEUED_FOR_PRINT);
      const res = await record(s.jobId, { reason: "PAPER_JAM" }).expect(409);
      expect(res.body.error_code).toBe("JOB_NOT_FAILED");
      expect((await job(s.jobId)).failureReason).toBeNull();
    },
  );

  it("accepts only the picker's values (400 for anything else, and for a missing reason)", async () => {
    const s = await seed("FAILED");
    await record(s.jobId, { reason: "BECAUSE" }).expect(400);
    await record(s.jobId, {}).expect(400);
    await record(s.jobId, { reason: "PAPER_JAM", note: "x".repeat(501) }).expect(400);
    expect((await job(s.jobId)).failureReason).toBeNull();
  });

  it("concurrent picks never 500: both succeed, last write wins, both audited", async () => {
    const s = await seed("FAILED");
    const responses = await Promise.all([
      record(s.jobId, { reason: "INK_TONER" }),
      record(s.jobId, { reason: "WRONG_PAPER" }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(["INK_TONER", "WRONG_PAPER"]).toContain((await job(s.jobId)).failureReason);
    expect(
      await fx.prisma.auditLog.count({
        where: { resourceId: s.jobId, action: "JOB_FAILURE_REASON_RECORDED" },
      }),
    ).toBe(2);
  });

  it("staff resolving an UNKNOWN job as failed can pick the reason in the same call", async () => {
    const s = await seed("UNKNOWN", OrderStatus.PRINT_STATUS_UNKNOWN);
    const res = await request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${s.orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ resolution: "MARK_FAILED", failureReason: "POOR_QUALITY", failureNote: "streaks" })
      .expect(200);
    const row = await job(s.jobId);
    expect(row.status).toBe("FAILED");
    expect(row.failureReason).toBe("POOR_QUALITY");
    expect(row.failureNote).toBe("streaks");
    expect(res.body.printJobs[0]).toMatchObject({ failureReason: "POOR_QUALITY" });
  });

  it("a MARK_FAILED without a reason still works and leaves the reason NULL (picking is optional at resolve time)", async () => {
    const s = await seed("UNKNOWN", OrderStatus.PRINT_STATUS_UNKNOWN);
    await request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${s.orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ resolution: "MARK_FAILED" })
      .expect(200);
    expect((await job(s.jobId)).failureReason).toBeNull();
  });

  it("a failureReason on a non-MARK_FAILED resolution is refused (400): it would be recorded on a job that did not fail", async () => {
    const s = await seed("UNKNOWN", OrderStatus.PRINT_STATUS_UNKNOWN);
    await request(fx.app.getHttpServer())
      .post(`/v1/shop/orders/${s.orderId}/resolve-unknown`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ resolution: "CONFIRMED_PRINTED", failureReason: "PAPER_JAM" })
      .expect(400);
    expect((await job(s.jobId)).status).toBe("UNKNOWN");
  });

  it("the shop order detail surfaces the reason on each job", async () => {
    const s = await seed("FAILED");
    await record(s.jobId, { reason: "FILE_PROBLEM" }).expect(200);
    const res = await request(fx.app.getHttpServer())
      .get(`/v1/shop/orders/${s.orderId}`)
      .set("Authorization", `Bearer ${fx.token}`)
      .expect(200);
    expect(res.body.printJobs[0]).toMatchObject({ id: s.jobId, failureReason: "FILE_PROBLEM" });
  });

  it("SHOP_COUNTER gets 403; another shop's owner is denied; unauthenticated is 401", async () => {
    const s = await seed("FAILED");
    await record(s.jobId, { reason: "PAPER_JAM" }, counterToken).expect(403);
    const denied = await record(s.jobId, { reason: "PAPER_JAM" }, other.token);
    expect([403, 404]).toContain(denied.status);
    await request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${s.jobId}/failure-reason`)
      .send({ reason: "PAPER_JAM" })
      .expect(401);
    expect((await job(s.jobId)).failureReason).toBeNull();
  });
});
