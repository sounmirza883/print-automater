import { randomUUID } from "node:crypto";
import { OrderStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import { OrderStateMachine } from "@print-automated/backend-shared";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 21.3 (PRD 68/69): the per-shop quality check. Real Postgres, real HTTP, and
 * the real agent path (claim -> printing -> printed) drives the order into QC. */
describe("Quality check (21.3, e2e)", () => {
  let fx: Fx;
  let off: Fx;
  let other: Fx;
  let deviceId: string;
  let offDeviceId: string;
  let operatorToken: string;
  let counterToken: string;

  async function staff(f: Fx, role: UserRole): Promise<string> {
    const user = await f.prisma.user.create({
      data: {
        role,
        name: `qc ${role}`,
        email: `qc-${role}-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    f.userIds.push(user.id);
    await f.prisma.shopStaff.create({
      data: { shopId: f.shop.id, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
    });
    return f.app.get(TokenService).issueAccessToken(user);
  }

  beforeAll(async () => {
    fx = await createPhase19Fixture("qc-on", { multiItemEnabled: true });
    off = await createPhase19Fixture("qc-off", { multiItemEnabled: false });
    other = await createPhase19Fixture("qc-other", { multiItemEnabled: true });
    await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { qualityCheckEnabled: true } });
    deviceId = (await fx.makePrinter("QC-A")).deviceId;
    offDeviceId = (await off.makePrinter("QC-OFF-A")).deviceId;
    operatorToken = await staff(fx, UserRole.OPERATOR);
    counterToken = await staff(fx, UserRole.SHOP_COUNTER);
  });
  afterAll(async () => {
    await other?.cleanup();
    await off?.cleanup();
    await fx?.cleanup();
  });

  const order = (f: Fx, id: string) => f.prisma.order.findUniqueOrThrow({ where: { id } });
  const jobsOf = (f: Fx, orderId: string) =>
    f.prisma.printJob.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  const call = (f: Fx, orderId: string, path: string, body: object = {}, token = f.token) =>
    request(f.app.getHttpServer())
      .post(`/v1/shop/orders/${orderId}/${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  /** accept -> agent claims, starts and finishes every live job. */
  async function acceptAndPrint(f: Fx, device: string, orderId: string): Promise<void> {
    await call(f, orderId, "accept").expect(200);
    await printLiveJobs(f, device, orderId);
  }
  async function printLiveJobs(f: Fx, device: string, orderId: string): Promise<void> {
    const agent = f.app.get(AgentJobsService);
    const live = (await jobsOf(f, orderId)).filter((j) => j.status === "QUEUED");
    for (const j of live) {
      await agent.claim(j.id, device);
      await agent.reportStatus(j.id, device, { status: "PRINTING" });
      await agent.reportStatus(j.id, device, { status: "PRINTED" });
    }
  }

  describe("flag ON", () => {
    it("accepting marks the order PENDING; when every job printed the order waits in QUALITY_CHECK, and READY/COMPLETE are blocked", async () => {
      const { orderId } = await fx.makeOrder(1);
      await call(fx, orderId, "accept").expect(200);
      expect((await order(fx, orderId)).qualityCheckStatus).toBe("PENDING");
      await printLiveJobs(fx, deviceId, orderId);
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.QUALITY_CHECK);

      const ready = await call(fx, orderId, "ready").expect(409);
      expect(ready.body.error_code).toBe("QUALITY_CHECK_REQUIRED");
      const complete = await call(fx, orderId, "complete").expect(409);
      expect(complete.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.QUALITY_CHECK);
    });

    it("PASSED releases the order to READY_FOR_COLLECTION, records the result, audits actor and note, notifies the customer once", async () => {
      const { orderId } = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, orderId);
      const res = await call(fx, orderId, "quality-check", {
        result: "PASSED",
        note: "clean",
      }).expect(200);
      expect(res.body).toMatchObject({
        orderStatus: "READY_FOR_COLLECTION",
        qualityCheckStatus: "PASSED",
      });
      expect((await order(fx, orderId)).qualityCheckStatus).toBe("PASSED");
      const audit = await fx.prisma.auditLog.findFirst({
        where: { resourceId: orderId, action: "ORDER_QC_PASS" },
      });
      expect(audit?.actorId).toBe(fx.owner.id);
      expect(audit?.metadata).toMatchObject({
        from: "QUALITY_CHECK",
        to: "READY_FOR_COLLECTION",
        note: "clean",
      });
      expect(
        await fx.prisma.notification.count({
          where: { orderId, type: "READY_FOR_COLLECTION", channel: "APP" },
        }),
      ).toBe(1);
      await call(fx, orderId, "complete").expect(200);
    });

    it("FAILED moves the order to PRINT_FAILED with qc FAILED, and it stays there when re-derived from its (printed) jobs", async () => {
      const { orderId } = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, orderId);
      await call(fx, orderId, "quality-check", { result: "FAILED", note: "smudged" }).expect(200);
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
      expect((await order(fx, orderId)).qualityCheckStatus).toBe("FAILED");
      const audit = await fx.prisma.auditLog.findFirst({
        where: { resourceId: orderId, action: "ORDER_QC_FAIL" },
      });
      expect(audit?.metadata).toMatchObject({ note: "smudged" });
      // aggregate agrees: a re-derive from the (all PRINTED) jobs must not flip it back
      await fx.app.get(OrderStateMachine).syncFromJobs(orderId, { id: null });
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.PRINT_FAILED);
    });

    it("NEEDS_REPRINT sends the order back to print through the normal allocation path: a NEW job (attempt 2), the original untouched, QC pending again; passing the reprint releases the order", async () => {
      const { orderId } = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, orderId);
      const [original] = await jobsOf(fx, orderId);
      const res = await call(fx, orderId, "quality-check", { result: "NEEDS_REPRINT" }).expect(200);
      expect(res.body.orderStatus).toBe("QUEUED_FOR_PRINT");

      const jobs = await jobsOf(fx, orderId);
      expect(jobs).toHaveLength(2);
      const untouched = jobs.find((j) => j.id === original!.id)!;
      expect(untouched.status).toBe("PRINTED");
      expect(untouched.supersededAt).toBeNull();
      const reprint = jobs.find((j) => j.id !== original!.id)!;
      expect(reprint).toMatchObject({
        attempt: 2,
        status: "QUEUED",
        orderItemId: original!.orderItemId,
      });
      expect(reprint.idempotencyToken).not.toBe(original!.idempotencyToken);
      expect((await order(fx, orderId)).qualityCheckStatus).toBe("PENDING");
      // 21.4: the verdict is recorded as a reprint of the original (default reason POOR_QUALITY)
      const link = await fx.prisma.printJobReprint.findUniqueOrThrow({
        where: { originalJobId: original!.id },
      });
      expect(link).toMatchObject({
        reprintJobId: reprint.id,
        reason: "POOR_QUALITY",
        source: "QUALITY_CHECK",
        requestedBy: fx.owner.id,
        additionalCostMinor: 0,
      });

      await printLiveJobs(fx, deviceId, orderId);
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.QUALITY_CHECK);
      await call(fx, orderId, "quality-check", { result: "PASSED" }).expect(200);
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);
    });

    it("NEEDS_REPRINT with jobIds reprints only the named items of a multi-item order; a job from another order is refused", async () => {
      const { orderId, itemIds } = await fx.makeOrder(2);
      await acceptAndPrint(fx, deviceId, orderId);
      const jobs = await jobsOf(fx, orderId);
      const first = jobs.find((j) => j.orderItemId === itemIds[0])!;

      const foreign = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, foreign.orderId);
      const foreignJob = (await jobsOf(fx, foreign.orderId))[0]!;
      const bad = await call(fx, orderId, "quality-check", {
        result: "NEEDS_REPRINT",
        jobIds: [foreignJob.id],
      }).expect(409);
      expect(bad.body.error_code).toBe("REPRINT_JOB_INVALID");
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.QUALITY_CHECK);
      expect(await jobsOf(fx, orderId)).toHaveLength(2);

      await call(fx, orderId, "quality-check", {
        result: "NEEDS_REPRINT",
        jobIds: [first.id],
      }).expect(200);
      const after = await jobsOf(fx, orderId);
      expect(after).toHaveLength(3);
      expect(after.filter((j) => j.orderItemId === itemIds[0])).toHaveLength(2);
      expect(after.filter((j) => j.orderItemId === itemIds[1])).toHaveLength(1);
    });

    it("two concurrent verdicts: exactly one wins, the loser gets a clean 409, order and qc status agree", async () => {
      const { orderId } = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, orderId);
      const responses = await Promise.all([
        call(fx, orderId, "quality-check", { result: "PASSED" }),
        call(fx, orderId, "quality-check", { result: "FAILED" }),
        call(fx, orderId, "quality-check", { result: "NEEDS_REPRINT" }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      const final = await order(fx, orderId);
      const expected = {
        READY_FOR_COLLECTION: "PASSED",
        PRINT_FAILED: "FAILED",
        QUEUED_FOR_PRINT: "PENDING",
      } as Record<string, string>;
      expect(final.qualityCheckStatus).toBe(expected[final.orderStatus]);
      // never more than one reprint job
      expect((await jobsOf(fx, orderId)).length).toBeLessThanOrEqual(2);
    });

    it("refuses a verdict when the order is not in QUALITY_CHECK (409 ILLEGAL_ORDER_TRANSITION)", async () => {
      const { orderId } = await fx.makeOrder(1);
      await call(fx, orderId, "accept").expect(200);
      const res = await call(fx, orderId, "quality-check", { result: "PASSED" }).expect(409);
      expect(res.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");
      expect((await order(fx, orderId)).qualityCheckStatus).toBe("PENDING");
    });

    it("an OPERATOR may record a verdict; SHOP_COUNTER (no QUALITY_CHECK) gets 403; another shop is denied; bad body is 400", async () => {
      const { orderId } = await fx.makeOrder(1);
      await acceptAndPrint(fx, deviceId, orderId);
      await call(fx, orderId, "quality-check", { result: "PASSED" }, counterToken).expect(403);
      const denied = await call(fx, orderId, "quality-check", { result: "PASSED" }, other.token);
      expect([403, 404]).toContain(denied.status);
      await call(fx, orderId, "quality-check", { result: "MAYBE" }).expect(400);
      expect((await order(fx, orderId)).orderStatus).toBe(OrderStatus.QUALITY_CHECK);
      await call(fx, orderId, "quality-check", { result: "PASSED" }, operatorToken).expect(200);
    });
  });

  describe("flag OFF (byte-identical to today)", () => {
    it("qc stays NOT_REQUIRED, the order goes straight to PRINTED, READY works, and no QC verdict is possible", async () => {
      const { orderId } = await off.makeOrder(1);
      await acceptAndPrint(off, offDeviceId, orderId);
      const printed = await order(off, orderId);
      expect(printed.orderStatus).toBe(OrderStatus.PRINTED);
      expect(printed.qualityCheckStatus).toBe("NOT_REQUIRED");
      const verdict = await call(off, orderId, "quality-check", { result: "PASSED" }).expect(409);
      expect(verdict.body.error_code).toBe("ILLEGAL_ORDER_TRANSITION");
      await call(off, orderId, "ready").expect(200);
      expect((await order(off, orderId)).orderStatus).toBe(OrderStatus.READY_FOR_COLLECTION);
      expect(
        await off.prisma.auditLog.count({
          where: { resourceId: orderId, action: { startsWith: "ORDER_QC_" } },
        }),
      ).toBe(0);
      expect((await order(off, orderId)).qualityCheckStatus).toBe("NOT_REQUIRED");
    });
  });
});
