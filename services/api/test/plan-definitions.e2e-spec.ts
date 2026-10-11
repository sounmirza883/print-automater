import { randomUUID } from "node:crypto";
import { Prisma, ShopStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { AuditAction } from "../src/audit/audit-action.js";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

const DAY_MS = 86_400_000;
/** Generous wall-clock slack for "computed from now()" assertions (request latency). */
const SLACK_MS = 5_000;

interface PlanBody {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingPeriodDays: number;
  description: string | null;
  archived: boolean;
  subscriberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Plan management: named, priced plan definitions (platform-wide CRUD at
 * `/v1/admin/plans`) assigned to a business through
 * `POST /v1/admin/businesses/:shopId/plan/activate` (assign / renew / switch) and
 * `.../plan/cancel`. Every route returning a business's plan now carries the
 * joined `plan` definition (or null). ADMIN only, like the rest of `/admin`. */
describe("Plan definitions + per-business plan assignment (e2e)", () => {
  let fx: Fx;
  let adminId: string;
  let adminToken: string;
  /** A second business, for "N businesses are assigned" counts. */
  let otherShopId: string;
  const planIds: string[] = [];

  beforeAll(async () => {
    fx = await createPhase19Fixture("plan-defs", { multiItemEnabled: false });
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Plan Definitions E2E Admin",
        email: `plan-defs-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    adminId = admin.id;
    adminToken = fx.app.get(TokenService).issueAccessToken(admin);
    const other = await fx.prisma.shop.create({
      data: { name: `plan-defs other shop ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });
    otherShopId = other.id;
  });

  afterAll(async () => {
    // shop_plans.plan_definition_id is ON DELETE RESTRICT: unassign before deleting.
    await fx.prisma.shopPlan.updateMany({
      where: { planDefinitionId: { in: planIds } },
      data: { planDefinitionId: null },
    });
    await fx.prisma.planDefinition.deleteMany({ where: { id: { in: planIds } } });
    await fx.prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await fx.prisma.shop.deleteMany({ where: { id: otherShopId } });
    await fx.prisma.user.deleteMany({ where: { id: adminId } });
    await fx?.cleanup();
  });

  const http = () => request(fx.app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });

  async function createPlan(overrides: Record<string, unknown> = {}): Promise<PlanBody> {
    const res = await http()
      .post("/v1/admin/plans")
      .set(admin())
      .send({
        name: `E2E Plan ${randomUUID()}`,
        priceMinor: 150_000,
        currency: "PKR",
        billingPeriodDays: 30,
        ...overrides,
      });
    expect(res.status).toBe(201);
    planIds.push(res.body.id as string);
    return res.body as PlanBody;
  }

  async function setShopPlan(
    shopId: string,
    data: { expiresAt?: Date | null; planDefinitionId?: string | null },
  ): Promise<void> {
    await fx.prisma.shopPlan.update({ where: { shopId }, data });
  }

  async function activate(shopId: string, planDefinitionId: string) {
    return http()
      .post(`/v1/admin/businesses/${shopId}/plan/activate`)
      .set(admin())
      .send({ planDefinitionId });
  }

  async function listedPlan(id: string): Promise<PlanBody | undefined> {
    const res = await http().get("/v1/admin/plans").set(admin());
    expect(res.status).toBe(200);
    return (res.body.items as PlanBody[]).find((p) => p.id === id);
  }

  describe("plan definition CRUD", () => {
    it("create -> list (subscriberCount 0) -> get -> patch -> delete, every mutation audited", async () => {
      const name = `E2E Starter ${randomUUID()}`;
      const createRes = await http().post("/v1/admin/plans").set(admin()).send({
        name,
        priceMinor: 250_000,
        currency: "pkr",
        billingPeriodDays: 30,
        description: "Starter tier",
        // Never settable on create -- stripped, not honoured.
        archived: true,
        subscriberCount: 42,
        id: randomUUID(),
      });
      expect(createRes.status).toBe(201);
      planIds.push(createRes.body.id as string);
      const created = createRes.body as PlanBody;
      expect(created).toEqual({
        id: expect.any(String),
        name,
        priceMinor: 250_000,
        currency: "PKR",
        billingPeriodDays: 30,
        description: "Starter tier",
        archived: false,
        subscriberCount: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const createdAudit = await fx.prisma.auditLog.findFirst({
        where: { action: AuditAction.PLAN_DEFINITION_CREATED, resourceId: created.id },
      });
      expect(createdAudit).toMatchObject({ actorId: adminId, resourceType: "plan_definition" });

      expect(await listedPlan(created.id)).toMatchObject({ name, subscriberCount: 0 });

      const getRes = await http().get(`/v1/admin/plans/${created.id}`).set(admin());
      expect(getRes.status).toBe(200);
      expect(getRes.body).toEqual(created);

      const patchRes = await http()
        .patch(`/v1/admin/plans/${created.id}`)
        .set(admin())
        .send({ priceMinor: 300_000, billingPeriodDays: 31, description: null });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body).toMatchObject({
        id: created.id,
        name,
        priceMinor: 300_000,
        currency: "PKR",
        billingPeriodDays: 31,
        description: null,
        archived: false,
        subscriberCount: 0,
      });
      const updatedAudit = await fx.prisma.auditLog.findFirst({
        where: { action: AuditAction.PLAN_DEFINITION_UPDATED, resourceId: created.id },
      });
      expect(updatedAudit?.metadata).toMatchObject({
        changedKeys: ["priceMinor", "billingPeriodDays", "description"],
        before: { priceMinor: 250_000, billingPeriodDays: 30, description: "Starter tier" },
        after: { priceMinor: 300_000, billingPeriodDays: 31, description: null },
      });

      const deleteRes = await http().delete(`/v1/admin/plans/${created.id}`).set(admin());
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({ result: "DELETED" });
      expect(await fx.prisma.planDefinition.findUnique({ where: { id: created.id } })).toBeNull();
      const deletedAudit = await fx.prisma.auditLog.findFirst({
        where: { action: AuditAction.PLAN_DEFINITION_DELETED, resourceId: created.id },
      });
      expect(deletedAudit?.metadata).toMatchObject({ before: { name, priceMinor: 300_000 } });

      const goneRes = await http().get(`/v1/admin/plans/${created.id}`).set(admin());
      expect(goneRes.status).toBe(404);
      expect(goneRes.body.error_code).toBe("PLAN_DEFINITION_NOT_FOUND");
    });

    it("a PATCH that changes nothing writes no audit row", async () => {
      const plan = await createPlan({ priceMinor: 1_000 });
      const res = await http()
        .patch(`/v1/admin/plans/${plan.id}`)
        .set(admin())
        .send({ priceMinor: 1_000 });
      expect(res.status).toBe(200);
      expect(
        await fx.prisma.auditLog.count({
          where: { action: AuditAction.PLAN_DEFINITION_UPDATED, resourceId: plan.id },
        }),
      ).toBe(0);
    });

    it("a duplicate name is a clean 409, on create and on rename -- never a raw 500", async () => {
      const a = await createPlan();
      const b = await createPlan();
      const dupCreate = await http().post("/v1/admin/plans").set(admin()).send({
        name: a.name,
        priceMinor: 1,
        currency: "PKR",
        billingPeriodDays: 1,
      });
      expect(dupCreate.status).toBe(409);
      expect(dupCreate.body.error_code).toBe("PLAN_DEFINITION_NAME_TAKEN");

      const dupRename = await http()
        .patch(`/v1/admin/plans/${b.id}`)
        .set(admin())
        .send({ name: a.name });
      expect(dupRename.status).toBe(409);
      expect(dupRename.body.error_code).toBe("PLAN_DEFINITION_NAME_TAKEN");
    });

    it("invalid bodies are 400; unknown ids are 404 on get/patch/delete", async () => {
      const bad = await http().post("/v1/admin/plans").set(admin()).send({
        name: "No price",
        currency: "PKR",
        billingPeriodDays: 30,
      });
      expect(bad.status).toBe(400);
      const badCurrency = await http()
        .post("/v1/admin/plans")
        .set(admin())
        .send({ name: "x", priceMinor: 1, currency: "RUPEES", billingPeriodDays: 30 });
      expect(badCurrency.status).toBe(400);

      const unknown = randomUUID();
      for (const res of [
        await http().get(`/v1/admin/plans/${unknown}`).set(admin()),
        await http().patch(`/v1/admin/plans/${unknown}`).set(admin()).send({ priceMinor: 5 }),
        await http().delete(`/v1/admin/plans/${unknown}`).set(admin()),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error_code).toBe("PLAN_DEFINITION_NOT_FOUND");
      }
    });
  });

  describe("assigning a plan to a business", () => {
    it("a fresh business (never assigned a named plan) reads plan: null everywhere, not a crash", async () => {
      const adminRes = await http().get(`/v1/admin/businesses/${otherShopId}/plan`).set(admin());
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.plan).toBeNull();
      const shopRes = await http().get(`/v1/shop/plan?shopId=${fx.shop.id}`).set(owner());
      expect(shopRes.status).toBe(200);
      expect(shopRes.body).toHaveProperty("plan", null);
    });

    it("activate assigns the plan and computes the expiry from ITS billingPeriodDays; renew with the same plan extends from the current expiry; a different plan switches it", async () => {
      const monthly = await createPlan({ billingPeriodDays: 30, priceMinor: 200_000 });
      const yearly = await createPlan({ billingPeriodDays: 365, priceMinor: 2_000_000 });
      // Expired, so the first assignment starts from now.
      await setShopPlan(fx.shop.id, { expiresAt: new Date(Date.now() - DAY_MS) });

      const assignRes = await activate(fx.shop.id, monthly.id);
      expect(assignRes.status).toBe(201);
      expect(assignRes.body).toMatchObject({
        shopId: fx.shop.id,
        active: true,
        plan: { id: monthly.id, name: monthly.name, billingPeriodDays: 30, subscriberCount: 1 },
      });
      const firstExpiry = new Date(assignRes.body.expiresAt as string).getTime();
      expect(Math.abs(firstExpiry - (Date.now() + 30 * DAY_MS))).toBeLessThan(SLACK_MS);
      const row = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: fx.shop.id } });
      expect(row.planDefinitionId).toBe(monthly.id);
      expect(row.activatedByUserId).toBe(adminId);
      const activatedAudit = await fx.prisma.auditLog.findFirst({
        where: { action: AuditAction.SHOP_PLAN_ACTIVATED, resourceId: fx.shop.id },
        orderBy: { createdAt: "desc" },
      });
      // The price at the moment of assignment is recorded, so a later price edit never
      // rewrites what this business was assigned at.
      expect(activatedAudit?.metadata).toMatchObject({
        planDefinitionId: monthly.id,
        previousPlanDefinitionId: null,
        days: 30,
        priceMinor: 200_000,
        currency: "PKR",
      });

      // The shop's own staff see the same joined plan.
      const shopRes = await http().get(`/v1/shop/plan?shopId=${fx.shop.id}`).set(owner());
      expect(shopRes.status).toBe(200);
      expect(shopRes.body.plan).toMatchObject({ id: monthly.id, priceMinor: 200_000 });

      // Renew: same plan again -> extends from the CURRENT (still-active) expiry, not now.
      const renewRes = await activate(fx.shop.id, monthly.id);
      expect(renewRes.status).toBe(201);
      const renewedExpiry = new Date(renewRes.body.expiresAt as string).getTime();
      expect(renewedExpiry).toBe(firstExpiry + 30 * DAY_MS);
      expect(renewRes.body.plan).toMatchObject({ id: monthly.id, subscriberCount: 1 });

      // Switch: a different plan -> reassigned, extended by the NEW plan's period.
      const switchRes = await activate(fx.shop.id, yearly.id);
      expect(switchRes.status).toBe(201);
      expect(new Date(switchRes.body.expiresAt as string).getTime()).toBe(
        renewedExpiry + 365 * DAY_MS,
      );
      expect(switchRes.body.plan).toMatchObject({ id: yearly.id, subscriberCount: 1 });
      expect(
        (await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: fx.shop.id } }))
          .planDefinitionId,
      ).toBe(yearly.id);
      expect(await listedPlan(monthly.id)).toMatchObject({ subscriberCount: 0 });
      expect(await listedPlan(yearly.id)).toMatchObject({ subscriberCount: 1 });

      const adminView = await http().get(`/v1/admin/businesses/${fx.shop.id}/plan`).set(admin());
      expect(adminView.body.plan).toMatchObject({ id: yearly.id });
    });

    it("two admins activating the same business at once both count (row lock): two periods, not one", async () => {
      const plan = await createPlan({ billingPeriodDays: 7 });
      const base = Date.now() + 10 * DAY_MS;
      await setShopPlan(otherShopId, { expiresAt: new Date(base) });
      const [a, b] = await Promise.all([
        activate(otherShopId, plan.id),
        activate(otherShopId, plan.id),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      const row = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: otherShopId } });
      expect(row.expiresAt!.getTime()).toBe(base + 14 * DAY_MS);
    });

    it("cancel clears the assignment and expires the plan immediately (audited); the business itself is untouched", async () => {
      const plan = await createPlan();
      await setShopPlan(otherShopId, { expiresAt: new Date(Date.now() + DAY_MS) });
      expect((await activate(otherShopId, plan.id)).status).toBe(201);

      const before = Date.now();
      const res = await http().post(`/v1/admin/businesses/${otherShopId}/plan/cancel`).set(admin());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ shopId: otherShopId, active: false, plan: null });
      const expiresAt = new Date(res.body.expiresAt as string).getTime();
      expect(expiresAt).toBeLessThanOrEqual(Date.now());
      expect(expiresAt).toBeGreaterThanOrEqual(before - SLACK_MS);

      const row = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: otherShopId } });
      expect(row.planDefinitionId).toBeNull();
      expect(await fx.prisma.shop.findUnique({ where: { id: otherShopId } })).not.toBeNull();
      const audit = await fx.prisma.auditLog.findFirst({
        where: { action: AuditAction.SHOP_PLAN_CANCELLED, resourceId: otherShopId },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toMatchObject({ actorId: adminId, resourceType: "shop_plan" });
      expect(audit?.metadata).toMatchObject({ previousPlanDefinitionId: plan.id });
      expect(await listedPlan(plan.id)).toMatchObject({ subscriberCount: 0 });

      // An already-expired plan is not pushed forward by a second cancel.
      const again = await http()
        .post(`/v1/admin/businesses/${otherShopId}/plan/cancel`)
        .set(admin());
      expect(again.status).toBe(201);
      expect(new Date(again.body.expiresAt as string).getTime()).toBe(expiresAt);
    });

    it("unknown business or unknown plan is a 404; the old { days } body is a 400", async () => {
      const plan = await createPlan();
      const unknownShop = randomUUID();
      const noShop = await activate(unknownShop, plan.id);
      expect(noShop.status).toBe(404);
      expect(noShop.body.error_code).toBe("SHOP_NOT_FOUND");
      const noShopCancel = await http()
        .post(`/v1/admin/businesses/${unknownShop}/plan/cancel`)
        .set(admin());
      expect(noShopCancel.status).toBe(404);
      const noShopGet = await http().get(`/v1/admin/businesses/${unknownShop}/plan`).set(admin());
      expect(noShopGet.status).toBe(404);

      const noPlan = await activate(fx.shop.id, randomUUID());
      expect(noPlan.status).toBe(404);
      expect(noPlan.body.error_code).toBe("PLAN_DEFINITION_NOT_FOUND");

      const oldBody = await http()
        .post(`/v1/admin/businesses/${fx.shop.id}/plan/activate`)
        .set(admin())
        .send({ days: 30 });
      expect(oldBody.status).toBe(400);
    });
  });

  describe("retiring a plan", () => {
    it("deleting a plan businesses are assigned to is refused 409 with the count; it works once they are moved off", async () => {
      const plan = await createPlan();
      expect((await activate(fx.shop.id, plan.id)).status).toBe(201);
      expect((await activate(otherShopId, plan.id)).status).toBe(201);

      const refused = await http().delete(`/v1/admin/plans/${plan.id}`).set(admin());
      expect(refused.status).toBe(409);
      expect(refused.body.error_code).toBe("PLAN_DEFINITION_IN_USE");
      expect(refused.body.message).toContain("2 businesses are currently assigned to this plan");
      expect(await fx.prisma.planDefinition.findUnique({ where: { id: plan.id } })).not.toBeNull();
      expect(await listedPlan(plan.id)).toMatchObject({ subscriberCount: 2 });

      await http().post(`/v1/admin/businesses/${otherShopId}/plan/cancel`).set(admin());
      const stillOne = await http().delete(`/v1/admin/plans/${plan.id}`).set(admin());
      expect(stillOne.status).toBe(409);
      expect(stillOne.body.message).toContain("1 business is currently assigned to this plan");

      await http().post(`/v1/admin/businesses/${fx.shop.id}/plan/cancel`).set(admin());
      const ok = await http().delete(`/v1/admin/plans/${plan.id}`).set(admin());
      expect(ok.status).toBe(200);
    });

    it("the database itself refuses deleting an assigned plan (ON DELETE RESTRICT backstop for a delete racing an assign)", async () => {
      const plan = await createPlan();
      expect((await activate(fx.shop.id, plan.id)).status).toBe(201);
      await expect(
        fx.prisma.planDefinition.delete({ where: { id: plan.id } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      await http().post(`/v1/admin/businesses/${fx.shop.id}/plan/cancel`).set(admin());
    });

    it("an archived plan cannot be newly assigned (409 PLAN_DEFINITION_ARCHIVED), but a business already on it keeps it", async () => {
      const plan = await createPlan();
      await setShopPlan(fx.shop.id, { expiresAt: new Date(Date.now() + DAY_MS) });
      expect((await activate(fx.shop.id, plan.id)).status).toBe(201);

      const archiveRes = await http()
        .patch(`/v1/admin/plans/${plan.id}`)
        .set(admin())
        .send({ archived: true });
      expect(archiveRes.status).toBe(200);
      expect(archiveRes.body).toMatchObject({ archived: true, subscriberCount: 1 });

      // Existing subscriber: unaffected.
      const existing = await http().get(`/v1/admin/businesses/${fx.shop.id}/plan`).set(admin());
      expect(existing.body).toMatchObject({ active: true, plan: { id: plan.id, archived: true } });

      const before = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: otherShopId } });
      const refused = await activate(otherShopId, plan.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error_code).toBe("PLAN_DEFINITION_ARCHIVED");
      const after = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: otherShopId } });
      expect(after).toEqual(before);

      // Unarchiving makes it assignable again.
      await http().patch(`/v1/admin/plans/${plan.id}`).set(admin()).send({ archived: false });
      expect((await activate(otherShopId, plan.id)).status).toBe(201);

      await http().post(`/v1/admin/businesses/${fx.shop.id}/plan/cancel`).set(admin());
      await http().post(`/v1/admin/businesses/${otherShopId}/plan/cancel`).set(admin());
    });
  });

  describe("authorization", () => {
    it("every plan-definition and plan-assignment admin route is 403 for a non-ADMIN (even the business's own owner) and 401 anonymously", async () => {
      const plan = await createPlan();
      const routes = [
        () => http().get("/v1/admin/plans"),
        () => http().get(`/v1/admin/plans/${plan.id}`),
        () =>
          http()
            .post("/v1/admin/plans")
            .send({
              name: `x ${randomUUID()}`,
              priceMinor: 1,
              currency: "PKR",
              billingPeriodDays: 1,
            }),
        () => http().patch(`/v1/admin/plans/${plan.id}`).send({ priceMinor: 2 }),
        () => http().delete(`/v1/admin/plans/${plan.id}`),
        () => http().get(`/v1/admin/businesses/${fx.shop.id}/plan`),
        () =>
          http()
            .post(`/v1/admin/businesses/${fx.shop.id}/plan/activate`)
            .send({ planDefinitionId: plan.id }),
        () => http().post(`/v1/admin/businesses/${fx.shop.id}/plan/cancel`),
      ];
      for (const route of routes) {
        expect((await route().set(owner())).status).toBe(403);
        expect((await route()).status).toBe(401);
      }
      // Nothing above changed anything.
      expect(await fx.prisma.planDefinition.findUnique({ where: { id: plan.id } })).toMatchObject({
        priceMinor: 150_000,
      });
      expect(
        (await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: fx.shop.id } }))
          .planDefinitionId,
      ).not.toBe(plan.id);
    });
  });

  /** `GET /v1/plans`: what the public marketing site's pricing section reads. */
  describe("public plan list", () => {
    it("needs no login and lists live plans, cheapest first, with only public fields", async () => {
      const pricey = await createPlan({ priceMinor: 9_000_000, description: "Big shops" });
      const cheap = await createPlan({ priceMinor: 1_000 });

      const res = await http().get("/v1/plans");
      expect(res.status).toBe(200);
      const items = res.body.items as Array<Record<string, unknown>>;
      const names = items.map((p) => p.name);
      expect(names.indexOf(cheap.name)).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(cheap.name)).toBeLessThan(names.indexOf(pricey.name));
      expect(items.find((p) => p.name === pricey.name)).toEqual({
        name: pricey.name,
        priceMinor: 9_000_000,
        currency: "PKR",
        billingPeriodDays: 30,
        description: "Big shops",
      });
    });

    it("stops listing a plan once an admin archives it, and lists it again when unarchived", async () => {
      const plan = await createPlan();
      const listed = async () =>
        ((await http().get("/v1/plans")).body.items as Array<{ name: string }>).some(
          (p) => p.name === plan.name,
        );
      expect(await listed()).toBe(true);

      await http().patch(`/v1/admin/plans/${plan.id}`).set(admin()).send({ archived: true });
      expect(await listed()).toBe(false);

      await http().patch(`/v1/admin/plans/${plan.id}`).set(admin()).send({ archived: false });
      expect(await listed()).toBe(true);
    });
  });
});
