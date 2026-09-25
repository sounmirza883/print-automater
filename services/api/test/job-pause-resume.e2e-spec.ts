import { randomUUID } from "node:crypto";
import { OrderStatus, PrinterStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

type JobStatus = "QUEUED" | "WAITING" | "PAUSED" | "CLAIMED" | "PRINTING" | "PRINTED";

/** 21.1 (PRD 65): staff pause/resume. Real Postgres, real HTTP. */
describe("Job pause / resume (21.1, e2e)", () => {
  let fx: Fx;
  let other: Fx;
  let printerA: string;
  let printerB: string;
  let deviceA: string;
  let counterToken: string;

  beforeAll(async () => {
    fx = await createPhase19Fixture("pause-resume", { multiItemEnabled: true });
    other = await createPhase19Fixture("pause-resume-other", { multiItemEnabled: true });
    const a = await fx.makePrinter("PR-A");
    const b = await fx.makePrinter("PR-B");
    printerA = a.printer.id;
    printerB = b.printer.id;
    deviceA = a.deviceId;
    const counter = await fx.prisma.user.create({
      data: {
        role: UserRole.SHOP_COUNTER,
        name: "pause counter",
        email: `pause-counter-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    await fx.prisma.shopStaff.create({
      data: {
        shopId: fx.shop.id,
        userId: counter.id,
        role: UserRole.SHOP_COUNTER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    counterToken = fx.app.get(TokenService).issueAccessToken(counter);
    // fixture cleanup deletes shop_staff / users it knows about; register the counter
    fx.userIds.push(counter.id);
  });
  afterAll(async () => {
    await other?.cleanup();
    await fx?.cleanup();
  });

  const agent = () => fx.app.get(AgentJobsService);
  const job = (id: string) => fx.prisma.printJob.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => fx.prisma.order.findUniqueOrThrow({ where: { id } });
  const post = (jobId: string, action: "pause" | "resume", body: object = {}, token = fx.token) =>
    request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${jobId}/${action}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  async function seed(status: JobStatus, printerId: string | null = printerA) {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const j = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId: status === "WAITING" || status === "PAUSED" ? null : printerId,
        status,
        idempotencyToken: `${itemIds[0]}:1`,
        ...(status === "WAITING" ? { blockedReason: "PRINTER_OFFLINE" } : {}),
      },
    });
    return { jobId: j.id, orderId, itemId: itemIds[0]! };
  }

  it("pauses a QUEUED job: unallocated, pausedAt set, audited with actor and reason, order shows PAUSED, agent can no longer claim it", async () => {
    const s = await seed("QUEUED");
    const res = await post(s.jobId, "pause", { reason: "customer called" }).expect(200);
    expect(res.body).toMatchObject({ id: s.jobId, status: "PAUSED", printerId: null });

    const paused = await job(s.jobId);
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.blockedReason).toBeNull();
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.PAUSED);
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: s.jobId, action: "PRINT_JOB_PAUSE" },
    });
    expect(audit?.actorId).toBe(fx.owner.id);
    expect(audit?.metadata).toMatchObject({
      from: "QUEUED",
      to: "PAUSED",
      reason: "customer called",
    });
    await expect(agent().claim(s.jobId, deviceA)).rejects.toMatchObject({
      errorCode: "JOB_NOT_FOUND",
    });
  });

  it("pauses a WAITING job too", async () => {
    const s = await seed("WAITING");
    await post(s.jobId, "pause").expect(200);
    expect((await job(s.jobId)).status).toBe("PAUSED");
    expect((await job(s.jobId)).blockedReason).toBeNull();
  });

  it.each(["CLAIMED", "PRINTING", "PRINTED"] as const)(
    "never pauses a %s job (an agent holds it or it is done): clean 409, row untouched",
    async (status) => {
      const s = await seed(status);
      const res = await post(s.jobId, "pause").expect(409);
      expect(res.body.error_code).toBe("ILLEGAL_JOB_TRANSITION");
      const after = await job(s.jobId);
      expect(after.status).toBe(status);
      expect(after.printerId).toBe(printerA);
    },
  );

  it("a concurrent double pause yields exactly one 200 and one clean 409", async () => {
    const s = await seed("QUEUED");
    const responses = await Promise.all([post(s.jobId, "pause"), post(s.jobId, "pause")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await fx.prisma.auditLog.count({ where: { resourceId: s.jobId, action: "PRINT_JOB_PAUSE" } }),
    ).toBe(1);
  });

  it("pause racing an agent claim: exactly one wins and the job is never both", async () => {
    const s = await seed("QUEUED");
    const [pauseRes, claimRes] = await Promise.allSettled([
      post(s.jobId, "pause"),
      agent().claim(s.jobId, deviceA),
    ]);
    const paused = pauseRes.status === "fulfilled" && pauseRes.value.status === 200;
    const claimed = claimRes.status === "fulfilled";
    expect(paused !== claimed).toBe(true);
    expect((await job(s.jobId)).status).toBe(paused ? "PAUSED" : "CLAIMED");
  });

  it("resume re-runs allocation: QUEUED on a printer, blockedReason cleared, pausedAt cleared, agent can claim, exactly one live job", async () => {
    const s = await seed("QUEUED");
    await post(s.jobId, "pause").expect(200);
    const res = await post(s.jobId, "resume").expect(200);
    expect(res.body.status).toBe("QUEUED");
    expect([printerA, printerB]).toContain(res.body.printerId);
    const resumed = await job(s.jobId);
    expect(resumed.blockedReason).toBeNull();
    expect(resumed.pausedAt).toBeNull();
    expect((await order(s.orderId)).orderStatus).toBe(OrderStatus.QUEUED_FOR_PRINT);
    expect(await fx.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(1);
    const device = res.body.printerId === printerA ? deviceA : undefined;
    if (device) {
      await agent().claim(s.jobId, device);
      expect((await job(s.jobId)).status).toBe("CLAIMED");
    }
  });

  it("resume with an explicit printerId queues it on that printer; a wrong/foreign printer is a clean 409 and the job stays PAUSED", async () => {
    const s = await seed("QUEUED");
    await post(s.jobId, "pause").expect(200);
    const foreign = await other.makePrinter("foreign");
    const bad = await post(s.jobId, "resume", { printerId: foreign.printer.id }).expect(409);
    expect(bad.body.error_code).toBe("PRINTER_NOT_AVAILABLE");
    expect((await job(s.jobId)).status).toBe("PAUSED");

    const res = await post(s.jobId, "resume", { printerId: printerB }).expect(200);
    expect(res.body).toMatchObject({ status: "QUEUED", printerId: printerB });
    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceId: s.jobId, action: "PRINT_JOB_RESUME_QUEUE" },
    });
    expect(audit?.metadata).toMatchObject({ printerId: printerB, explicitPrinter: true });
  });

  it("a concurrent double resume yields one 200 and one clean 409, one live job", async () => {
    const s = await seed("QUEUED");
    await post(s.jobId, "pause").expect(200);
    const responses = await Promise.all([post(s.jobId, "resume"), post(s.jobId, "resume")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await fx.prisma.printJob.count({ where: { orderId: s.orderId } })).toBe(1);
  });

  it("never resumes a job that is not PAUSED (QUEUED/CLAIMED): 409 and no re-dispatch", async () => {
    for (const status of ["QUEUED", "CLAIMED"] as const) {
      const s = await seed(status);
      const res = await post(s.jobId, "resume").expect(409);
      expect(res.body.error_code).toBe("ILLEGAL_JOB_TRANSITION");
      expect((await job(s.jobId)).status).toBe(status);
    }
  });

  describe("late-print hold (19.18 carry-forward)", () => {
    async function heldSuccessor() {
      const s = await seed("QUEUED");
      // an earlier, superseded attempt for the same item that reports PRINTED late
      const old = await fx.prisma.printJob.create({
        data: {
          orderId: s.orderId,
          shopId: fx.shop.id,
          orderItemId: s.itemId,
          printerId: printerA,
          status: "REASSIGNED",
          supersededAt: new Date(),
          attempt: 0,
          idempotencyToken: `${s.itemId}:0`,
        },
      });
      await agent().reportStatus(old.id, deviceA, { status: "PRINTED" });
      expect((await job(s.jobId)).status).toBe("PAUSED");
      expect((await job(s.jobId)).blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
      return { ...s, oldJobId: old.id };
    }

    it("resume needs an explicit acknowledgement; without it 409 LATE_PRINT_ACK_REQUIRED and the job stays held", async () => {
      const s = await heldSuccessor();
      const res = await post(s.jobId, "resume").expect(409);
      expect(res.body.error_code).toBe("LATE_PRINT_ACK_REQUIRED");
      expect((await job(s.jobId)).status).toBe("PAUSED");
      expect(
        await fx.prisma.auditLog.count({
          where: { resourceId: s.jobId, action: "PRINT_JOB_LATE_PRINT_ACKNOWLEDGED" },
        }),
      ).toBe(0);
    });

    it("with acknowledgeLatePrint it resumes with a FRESH blockedReason (never the stale MANUAL_APPROVAL_REQUIRED) and audits the acknowledgement", async () => {
      const s = await heldSuccessor();
      const res = await post(s.jobId, "resume", { acknowledgeLatePrint: true }).expect(200);
      expect(res.body.status).toBe("QUEUED");
      const after = await job(s.jobId);
      expect(after.blockedReason).toBeNull();
      expect(after.printerId).not.toBeNull();
      const ack = await fx.prisma.auditLog.findFirst({
        where: { resourceId: s.jobId, action: "PRINT_JOB_LATE_PRINT_ACKNOWLEDGED" },
      });
      expect(ack?.actorId).toBe(fx.owner.id);
      expect(ack?.metadata).toMatchObject({ supersededJobId: s.oldJobId });
    });

    it("a job staff paused BEFORE the late report arrives is also held: its resume needs the acknowledgement", async () => {
      const s = await seed("QUEUED");
      await post(s.jobId, "pause").expect(200);
      const old = await fx.prisma.printJob.create({
        data: {
          orderId: s.orderId,
          shopId: fx.shop.id,
          orderItemId: s.itemId,
          printerId: printerA,
          status: "REASSIGNED",
          supersededAt: new Date(),
          attempt: 0,
          idempotencyToken: `${s.itemId}:0`,
        },
      });
      await agent().reportStatus(old.id, deviceA, { status: "PRINTED" });
      const res = await post(s.jobId, "resume").expect(409);
      expect(res.body.error_code).toBe("LATE_PRINT_ACK_REQUIRED");
      await post(s.jobId, "resume", { acknowledgeLatePrint: true }).expect(200);
    });
  });

  describe("21.6: the late-print hold fails closed (lives on the job row, not in an audit row)", () => {
    async function oldAttempt(itemId: string, orderId: string) {
      return fx.prisma.printJob.create({
        data: {
          orderId,
          shopId: fx.shop.id,
          orderItemId: itemId,
          printerId: printerA,
          status: "REASSIGNED",
          supersededAt: new Date(),
          attempt: 0,
          idempotencyToken: `${itemId}:0`,
        },
      });
    }
    const holdAudits = () =>
      fx.prisma.auditLog.deleteMany({ where: { action: "PRINT_JOB_LATE_PRINT_SUCCESSOR" } });

    it("a staff-PAUSED successor is stamped MANUAL_APPROVAL_REQUIRED on its row by the late report, atomically with its own audit row", async () => {
      const s = await seed("QUEUED");
      await post(s.jobId, "pause").expect(200);
      expect((await job(s.jobId)).blockedReason).toBeNull();
      const old = await oldAttempt(s.itemId, s.orderId);
      await agent().reportStatus(old.id, deviceA, { status: "PRINTED" });
      const held = await job(s.jobId);
      expect(held.status).toBe("PAUSED");
      expect(held.blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
      expect(
        await fx.prisma.auditLog.count({
          where: { resourceId: s.jobId, action: "PRINT_JOB_HOLD" },
        }),
      ).toBe(1);
    });

    it("with the informational audit row missing (insert failed), resume without an acknowledgement is STILL refused, for both a staff-paused and a machine-paused successor", async () => {
      const paused = await seed("QUEUED");
      await post(paused.jobId, "pause").expect(200);
      const queued = await seed("QUEUED");
      const oldA = await oldAttempt(paused.itemId, paused.orderId);
      const oldB = await oldAttempt(queued.itemId, queued.orderId);
      await agent().reportStatus(oldA.id, deviceA, { status: "PRINTED" });
      await agent().reportStatus(oldB.id, deviceA, { status: "PRINTED" });
      await holdAudits(); // simulate the insert never having happened
      for (const j of [paused, queued]) {
        const res = await post(j.jobId, "resume").expect(409);
        expect(res.body.error_code).toBe("LATE_PRINT_ACK_REQUIRED");
        expect((await job(j.jobId)).status).toBe("PAUSED");
      }
    });

    it("a failing audit insert does not stop the hold (spy makes the informational insert throw)", async () => {
      const s = await seed("QUEUED");
      await post(s.jobId, "pause").expect(200);
      const old = await oldAttempt(s.itemId, s.orderId);
      const original = fx.prisma.auditLog.create.bind(fx.prisma.auditLog);
      const spy = jest.spyOn(fx.prisma.auditLog, "create").mockImplementation(((args: {
        data: { action: string };
      }) => {
        if (args.data.action === "PRINT_JOB_LATE_PRINT_SUCCESSOR") {
          throw new Error("audit insert failed");
        }
        return original(args as never);
      }) as never);
      try {
        await agent().reportStatus(old.id, deviceA, { status: "PRINTED" });
      } finally {
        spy.mockRestore();
      }
      expect((await job(s.jobId)).blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
      const res = await post(s.jobId, "resume").expect(409);
      expect(res.body.error_code).toBe("LATE_PRINT_ACK_REQUIRED");
    });

    it("a staff pause of an already-held job keeps the hold (never clears it)", async () => {
      const s = await seed("WAITING");
      await fx.prisma.printJob.update({
        where: { id: s.jobId },
        data: { blockedReason: "MANUAL_APPROVAL_REQUIRED" },
      });
      await post(s.jobId, "pause").expect(200);
      expect((await job(s.jobId)).blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
      const res = await post(s.jobId, "resume").expect(409);
      expect(res.body.error_code).toBe("LATE_PRINT_ACK_REQUIRED");
    });

    it("race: a plain resume versus the late report (Promise.all, repeated) never leaves the successor dispatchable", async () => {
      for (let i = 0; i < 6; i += 1) {
        const s = await seed("QUEUED");
        await post(s.jobId, "pause").expect(200);
        const old = await oldAttempt(s.itemId, s.orderId);
        const [resume] = await Promise.allSettled([
          post(s.jobId, "resume"),
          agent().reportStatus(old.id, deviceA, { status: "PRINTED" }),
        ]);
        const final = await job(s.jobId);
        // Whoever wins: the job is held, never QUEUED/WAITING without an acknowledgement.
        expect(final.status).toBe("PAUSED");
        expect(final.blockedReason).toBe("MANUAL_APPROVAL_REQUIRED");
        if (resume.status === "fulfilled") {
          expect([200, 409]).toContain(resume.value.status);
        }
      }
    });
  });

  describe("authorization and tenancy", () => {
    it("SHOP_COUNTER (no PAUSE_JOBS) gets 403 on both routes", async () => {
      const s = await seed("QUEUED");
      await post(s.jobId, "pause", {}, counterToken).expect(403);
      await post(s.jobId, "resume", {}, counterToken).expect(403);
      expect((await job(s.jobId)).status).toBe("QUEUED");
    });

    it("another shop's owner cannot pause or resume this shop's job", async () => {
      const s = await seed("QUEUED");
      const denied = await post(s.jobId, "pause", {}, other.token);
      expect([403, 404]).toContain(denied.status);
      expect((await job(s.jobId)).status).toBe("QUEUED");
    });

    it("requires authentication", async () => {
      const s = await seed("QUEUED");
      await request(fx.app.getHttpServer())
        .post(`/v1/print-jobs/${s.jobId}/pause`)
        .send({})
        .expect(401);
    });
  });
});

/** Resume when nothing is available right now: WAITING with a FRESH reason. */
describe("Job resume with no usable printer (21.1, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("pause-resume-none", { multiItemEnabled: true });
    await fx.makePrinter("only", { status: PrinterStatus.OFFLINE });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("goes to WAITING with the allocation's reason and no printer, not the stale hold reason", async () => {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const j = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        status: "PAUSED",
        blockedReason: "MANUAL_APPROVAL_REQUIRED",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    const res = await request(fx.app.getHttpServer())
      .post(`/v1/print-jobs/${j.id}/resume`)
      .set("Authorization", `Bearer ${fx.token}`)
      .send({ acknowledgeLatePrint: true })
      .expect(200);
    expect(res.body.status).toBe("WAITING");
    expect(res.body.printerId).toBeNull();
    expect(res.body.blockedReason).not.toBeNull();
    expect(res.body.blockedReason).not.toBe("MANUAL_APPROVAL_REQUIRED");
  });
});
