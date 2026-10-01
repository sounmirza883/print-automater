import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** 26 (Shop Plan / subscription system): a platform admin manually
 * activates/renews a business's plan; when it's expired, login, dashboards
 * and every non-print route keep working -- only the print pipeline itself
 * (dispatch AND claim) stops, per the user's own clarification: "they can
 * log in, that's fine, but the printing system should stop working." */
describe("Shop Plan (26, e2e)", () => {
  let fx: Fx;
  let adminToken: string;
  const extraUserIds: string[] = [];
  /** Plan management: activation assigns a named plan; its period is the extension. */
  let tenDayPlanId: string;

  beforeAll(async () => {
    fx = await createPhase19Fixture("shop-plan", {
      multiItemEnabled: false,
      documentPages: 3,
    });
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Plan E2E Admin",
        email: `plan-e2e-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    extraUserIds.push(admin.id);
    adminToken = fx.app.get(TokenService).issueAccessToken(admin);
    const plan = await fx.prisma.planDefinition.create({
      data: {
        name: `Shop Plan E2E 10-day ${randomUUID()}`,
        priceMinor: 1_000,
        currency: "PKR",
        billingPeriodDays: 10,
      },
    });
    tenDayPlanId = plan.id;
  });
  afterAll(async () => {
    // shop_plans.plan_definition_id is ON DELETE RESTRICT: unassign before deleting.
    await fx.prisma.shopPlan.updateMany({
      where: { planDefinitionId: tenDayPlanId },
      data: { planDefinitionId: null },
    });
    await fx.prisma.planDefinition.deleteMany({ where: { id: tenDayPlanId } });
    await fx.prisma.auditLog.deleteMany({ where: { actorId: { in: extraUserIds } } });
    await fx.prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await fx?.cleanup();
  });

  const http = () => request(fx.app.getHttpServer());
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  async function setExpiresAt(date: Date | null): Promise<void> {
    await fx.prisma.shopPlan.update({ where: { shopId: fx.shop.id }, data: { expiresAt: date } });
  }
  async function restoreGracePeriod(): Promise<void> {
    await setExpiresAt(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  }
  afterEach(async () => {
    await restoreGracePeriod();
  });

  it("a fresh shop starts with an active plan (the 30-day grace period), not requiring day-one admin activation", async () => {
    const res = await http().get(`/v1/shop/plan?shopId=${fx.shop.id}`).set(owner());
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.expiresAt).not.toBeNull();
    // Never assigned a named plan (plan management): null, not a crash.
    expect(res.body.plan).toBeNull();
  });

  it("admin activate extends (by the assigned plan's billing period) from the LATER of now or the current expiry, and is audited", async () => {
    const before = await http().get(`/v1/admin/businesses/${fx.shop.id}/plan`).set(admin());
    expect(before.status).toBe(200);
    const previousExpiresAt = new Date(before.body.expiresAt as string);

    const res = await http()
      .post(`/v1/admin/businesses/${fx.shop.id}/plan/activate`)
      .set(admin())
      .send({ planDefinitionId: tenDayPlanId });
    expect(res.status).toBe(201);
    expect(res.body.plan).toMatchObject({ id: tenDayPlanId, billingPeriodDays: 10 });
    const newExpiresAt = new Date(res.body.expiresAt as string);
    // Extends the EXISTING (still-active) expiry by 10 days, not from now.
    expect(newExpiresAt.getTime()).toBeCloseTo(previousExpiresAt.getTime() + 10 * 86_400_000, -3);

    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceType: "shop_plan", resourceId: fx.shop.id, action: "SHOP_PLAN_ACTIVATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toEqual(expect.any(String));
  });

  it("admin activate on an EXPIRED plan starts the new period from now, not from the stale expiry", async () => {
    await setExpiresAt(new Date(Date.now() - 86_400_000)); // expired yesterday
    const res = await http()
      .post(`/v1/admin/businesses/${fx.shop.id}/plan/activate`)
      .set(admin())
      .send({ planDefinitionId: tenDayPlanId });
    expect(res.status).toBe(201);
    const newExpiresAt = new Date(res.body.expiresAt as string);
    expect(newExpiresAt.getTime()).toBeCloseTo(Date.now() + 10 * 86_400_000, -3);
  });

  it("only ADMIN may activate a plan -- the shop's own owner gets 403", async () => {
    const res = await http()
      .post(`/v1/admin/businesses/${fx.shop.id}/plan/activate`)
      .set(owner())
      .send({ planDefinitionId: tenDayPlanId });
    expect(res.status).toBe(403);
  });

  it("GET /v1/shop/plan is 403 for staff of a different shop", async () => {
    const other = await createPhase19Fixture("shop-plan-other", { multiItemEnabled: false });
    try {
      const res = await http()
        .get(`/v1/shop/plan?shopId=${fx.shop.id}`)
        .set({ Authorization: `Bearer ${other.token}` });
      expect(res.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("an expired plan blocks accept with SHOP_PLAN_EXPIRED, leaving the order unprinted -- but login/dashboards keep working", async () => {
    await fx.makePrinter("plan-expired-printer");
    const { orderId } = await fx.makeOrder(1);
    await setExpiresAt(new Date(Date.now() - 1000));

    const acceptRes = await http().post(`/v1/shop/orders/${orderId}/accept`).set(owner());
    expect(acceptRes.status).toBe(409);
    expect(acceptRes.body.error_code).toBe("SHOP_PLAN_EXPIRED");
    expect(await fx.prisma.printJob.count({ where: { orderId } })).toBe(0);

    // Everything except the print pipeline itself keeps working.
    const dashboardRes = await http()
      .get(`/v1/shop/dashboard/owner?shopId=${fx.shop.id}`)
      .set(owner());
    expect(dashboardRes.status).toBe(200);
    const planRes = await http().get(`/v1/shop/plan?shopId=${fx.shop.id}`).set(owner());
    expect(planRes.status).toBe(200);
    expect(planRes.body.active).toBe(false);
  });

  it("a job queued while the plan was active cannot be claimed once the plan expires", async () => {
    // Isolate from printers earlier tests in this file created (e.g. the
    // accept-blocking test's own printer, which is still ONLINE and would
    // otherwise also be a valid allocation candidate here).
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: "DISABLED" },
    });
    const { printer, deviceId } = await fx.makePrinter("plan-expiry-claim-printer");
    const { orderId } = await fx.makeOrder(1);
    const acceptRes = await http().post(`/v1/shop/orders/${orderId}/accept`).set(owner());
    expect(acceptRes.status).toBe(200);
    const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
    expect(job.status).toBe("QUEUED");
    expect(job.printerId).toBe(printer.id);

    await setExpiresAt(new Date(Date.now() - 1000));

    const agentJobs = fx.app.get(AgentJobsService);
    await expect(agentJobs.claim(job.id, deviceId)).rejects.toMatchObject({
      errorCode: "SHOP_PLAN_EXPIRED",
    });
    const stillQueued = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stillQueued.status).toBe("QUEUED");
  });
});
