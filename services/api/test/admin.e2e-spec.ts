import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import type Redis from "ioredis";
import { DocumentStatus, ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, AuditService, REDIS_CLIENT } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { PASSWORD_NOT_SET } from "../src/auth/password.service.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { AuditAction } from "../src/audit/audit-action.js";
import { NotificationService } from "../src/notifications/notification.service.js";

/** What the owner of a newly created business receives (captured, never really sent). */
interface OwnerMail {
  email: string;
  shopName: string;
  token: string;
}

/** §4.7/§42/16.5: an ADMIN can see across every business/user/audit
 * entry on the platform; nobody else -- not even a SHOP_OWNER -- can
 * reach any `/admin/*` route at all. */
describe("Platform admin API (§4.7/§42, 16.5, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let auditService: AuditService;

  let admin: { id: string; role: UserRole };
  let adminToken: string;
  let owner: { id: string; role: UserRole };
  let ownerToken: string;
  let shopA: { id: string };
  let shopB: { id: string };

  const shopIds: string[] = [];
  const userIds: string[] = [];
  const ownerMails: OwnerMail[] = [];

  /** Fix wave 1: the body every admin-created business now needs -- its intended owner. */
  function businessBody(label: string, overrides: Record<string, unknown> = {}) {
    return {
      name: `Admin E2E ${label} ${randomUUID()}`,
      address: "1 Onboarding Road",
      capabilities: { color: true, duplex: true, a4: true, a3: false },
      owner: {
        name: `Owner of ${label}`,
        email: `admin-e2e-new-owner-${randomUUID()}@print-automated.dev`,
        phone: "+92 300 0000000",
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Captures each emailed code instead of queueing a real email.
      .overrideProvider(NotificationService)
      .useValue({
        sendOwnerActivationInvite: async (email: string, shopName: string, token: string) => {
          ownerMails.push({ email, shopName, token });
        },
        sendStaffInvite: async () => undefined,
        sendPasswordRecovery: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    // One trusted proxy hop, so this suite's public (QR) calls can carry their own
    // client IP and never share a rate-limit bucket with public-orders.e2e-spec.ts.
    configureApp(app, { ...app.get<ApiEnv>(API_ENV), TRUST_PROXY_HOPS: 1 });
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
    auditService = app.get(AuditService);

    admin = await prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Admin E2E Admin",
        email: `admin-e2e-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(admin.id);
    adminToken = tokenService.issueAccessToken(admin);

    owner = await prisma.user.create({
      data: {
        role: UserRole.SHOP_OWNER,
        name: "Admin E2E Owner",
        email: `admin-e2e-owner-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(owner.id);
    ownerToken = tokenService.issueAccessToken(owner);

    shopA = await prisma.shop.create({
      data: { name: `Admin E2E Shop A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Admin E2E Shop B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });
    shopIds.push(shopA.id, shopB.id);
    await prisma.shopStaff.create({
      data: {
        shopId: shopA.id,
        userId: owner.id,
        role: UserRole.SHOP_OWNER,
        status: ShopStaffStatus.ACTIVE,
      },
    });

    await auditService.record({
      actorId: owner.id,
      action: "ADMIN_E2E_TEST_ACTION",
      resourceType: "admin-e2e-test",
      resourceId: shopA.id,
      metadata: { note: "fixture row" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { resourceType: { in: ["admin-e2e-test", "admin-e2e-login-test"] } },
    });
    // Everything an admin-created business may have gained during the fix-wave-1 journey.
    const shops = await prisma.shop.findMany({
      where: { id: { in: shopIds } },
      select: { qrSystemUserId: true },
    });
    const systemUserIds = shops.flatMap((s) => (s.qrSystemUserId ? [s.qrSystemUserId] : []));
    const staff = await prisma.shopStaff.findMany({
      where: { shopId: { in: shopIds } },
      select: { userId: true },
    });
    await prisma.order.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.document.deleteMany({ where: { ownerUserId: { in: systemUserIds } } });
    await prisma.pricingRule.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopStaff.deleteMany({
      where: { OR: [{ userId: owner.id }, { shopId: { in: shopIds } }] },
    });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [...userIds, ...systemUserIds, ...staff.map((s) => s.userId)] } },
    });
    await app.close();
  });

  it("ADMIN can list businesses across shops it has no staff membership at", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/businesses")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([shopA.id, shopB.id]));
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("ADMIN can list users across the whole platform, with no password hash leaked", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([admin.id, owner.id]));
    expect(res.body.items[0]).not.toHaveProperty("passwordHash");
  });

  it("ADMIN can list audit entries, filterable by resourceType", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/audit?resourceType=admin-e2e-test")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(
      (res.body.items as Array<{ resourceType: string }>).every(
        (entry) => entry.resourceType === "admin-e2e-test",
      ),
    ).toBe(true);
    expect(res.body.items[0].actorId).toBe(owner.id);
  });

  it("ADMIN can view a basic system status summary", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/system")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.readiness.ready).toBe(true);
    expect(res.body.counts.shops).toBeGreaterThanOrEqual(2);
  });

  it("ADMIN can create a business (never accepting a client id/status), see it listed, read its detail, and change its status -- both mutations audited", async () => {
    const name = `Admin E2E Created Shop ${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post("/v1/admin/businesses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...businessBody("Created Shop"),
        name,
        address: "123 Created St",
        // A client-supplied id/status must never win: the create schema
        // does not even accept these keys, so they are silently dropped.
        id: randomUUID(),
        status: ShopStatus.OPEN,
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ name, address: "123 Created St" });
    // Never the client-supplied status: a brand-new business is always CLOSED.
    expect(createRes.body.status).toBe(ShopStatus.CLOSED);
    const createdId = createRes.body.id as string;
    shopIds.push(createdId);

    const listRes = await request(app.getHttpServer())
      .get("/v1/admin/businesses")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect((listRes.body.items as Array<{ id: string }>).map((b) => b.id)).toContain(createdId);

    const detailRes = await request(app.getHttpServer())
      .get(`/v1/admin/businesses/${createdId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body).toMatchObject({
      id: createdId,
      name,
      status: ShopStatus.CLOSED,
      // Fix wave 1: never an empty shell any more -- its named owner is its first member.
      counts: { staff: 1, orders: 0, printers: 0 },
    });

    const statusRes = await request(app.getHttpServer())
      .patch(`/v1/admin/businesses/${createdId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: ShopStatus.OPEN });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe(ShopStatus.OPEN);

    const createAudit = await prisma.auditLog.findFirst({
      where: { action: "SHOP_CREATED", resourceId: createdId },
    });
    expect(createAudit?.actorId).toBe(admin.id);

    const statusAudit = await prisma.auditLog.findFirst({
      where: { action: "SHOP_STATUS_CHANGED", resourceId: createdId },
    });
    expect(statusAudit?.actorId).toBe(admin.id);
    expect(statusAudit?.metadata).toMatchObject({
      from: ShopStatus.CLOSED,
      to: ShopStatus.OPEN,
    });
  });

  it("a SHOP_OWNER gets 403 on every admin route, not elevated access", async () => {
    for (const path of [
      "/v1/admin/businesses",
      "/v1/admin/users",
      "/v1/admin/audit",
      "/v1/admin/system",
      `/v1/admin/businesses/${shopA.id}`,
      `/v1/admin/users/${owner.id}`,
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);
    }
    const createRes = await request(app.getHttpServer())
      .post("/v1/admin/businesses")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Owner-attempted shop", address: "nope" });
    expect(createRes.status).toBe(403);

    const statusRes = await request(app.getHttpServer())
      .patch(`/v1/admin/businesses/${shopA.id}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: ShopStatus.SUSPENDED });
    expect(statusRes.status).toBe(403);

    const roleChangeRes = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${owner.id}/role`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: UserRole.ADMIN });
    expect(roleChangeRes.status).toBe(403);

    const statusChangeRes = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${owner.id}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "SUSPENDED" });
    expect(statusChangeRes.status).toBe(403);
  });

  it("no token: 401 on every admin route", async () => {
    for (const path of [
      "/v1/admin/businesses",
      "/v1/admin/users",
      "/v1/admin/audit",
      "/v1/admin/system",
      `/v1/admin/businesses/${shopA.id}`,
      `/v1/admin/users/${owner.id}`,
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(401);
    }
    const createRes = await request(app.getHttpServer())
      .post("/v1/admin/businesses")
      .send({ name: "No token shop", address: "nope" });
    expect(createRes.status).toBe(401);

    const statusRes = await request(app.getHttpServer())
      .patch(`/v1/admin/businesses/${shopA.id}/status`)
      .send({ status: ShopStatus.SUSPENDED });
    expect(statusRes.status).toBe(401);

    const roleChangeRes = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${owner.id}/role`)
      .send({ role: UserRole.ADMIN });
    expect(roleChangeRes.status).toBe(401);

    const statusChangeRes = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${owner.id}/status`)
      .send({ status: "SUSPENDED" });
    expect(statusChangeRes.status).toBe(401);
  });

  describe("Workstream B: user management (GET /admin/users/:id, PATCH role/status)", () => {
    let target: { id: string; role: UserRole };

    beforeEach(async () => {
      target = await prisma.user.create({
        data: {
          role: UserRole.SHOP_MANAGER,
          name: "Admin E2E Target User",
          email: `admin-e2e-target-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(target.id);
    });

    it("ADMIN can read a user's detail", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/admin/users/${target.id}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: target.id, role: UserRole.SHOP_MANAGER });
      expect(res.body).not.toHaveProperty("passwordHash");
    });

    it("GET /admin/users/:id 404s for an id that does not exist", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/admin/users/${randomUUID()}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it("ADMIN can change another user's role, audited", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.SHOP_OWNER });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(UserRole.SHOP_OWNER);

      const reread = await prisma.user.findUnique({ where: { id: target.id } });
      expect(reread?.role).toBe(UserRole.SHOP_OWNER);

      const audit = await prisma.auditLog.findFirst({
        where: { action: "USER_ROLE_CHANGED", resourceId: target.id },
      });
      expect(audit?.actorId).toBe(admin.id);
      expect(audit?.metadata).toMatchObject({ from: "SHOP_MANAGER", to: UserRole.SHOP_OWNER });
    });

    it("ADMIN can grant another user ADMIN (no cross-role check, unlike ShopStaff)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(UserRole.ADMIN);
    });

    it("ADMIN can suspend another user's status, audited, and their refresh tokens are revoked", async () => {
      const pair = await tokenService.issueTokenPair(target);
      const before = await prisma.refreshToken.findMany({ where: { userId: target.id } });
      expect(before.length).toBeGreaterThanOrEqual(1);
      expect(before.every((t) => t.revokedAt === null)).toBe(true);
      expect(pair.refreshToken).toBeTruthy();

      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "SUSPENDED" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUSPENDED");

      const after = await prisma.refreshToken.findMany({ where: { userId: target.id } });
      expect(after.length).toBeGreaterThanOrEqual(1);
      expect(after.every((t) => t.revokedAt !== null)).toBe(true);

      const audit = await prisma.auditLog.findFirst({
        where: { action: "USER_STATUS_CHANGED", resourceId: target.id },
      });
      expect(audit?.actorId).toBe(admin.id);
      expect(audit?.metadata).toMatchObject({ from: "ACTIVE", to: "SUSPENDED" });
    });

    it("a suspended user's next refresh is refused (401) even with a token no revocation covered -- the suspend-vs-refresh race", async () => {
      const pair = await tokenService.issueTokenPair(target);
      const ok = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: pair.refreshToken });
      expect(ok.status).toBe(200);

      // The race: a refresh that rotated AFTER the admin's revokeAllForUser ran holds a
      // fresh, unrevoked token. Modelled by suspending without revoking anything.
      await prisma.user.update({ where: { id: target.id }, data: { status: "SUSPENDED" } });
      const refused = await request(app.getHttpServer())
        .post("/v1/auth/refresh")
        .send({ refreshToken: ok.body.refreshToken });
      expect(refused.status).toBe(401);
      expect(refused.body.error_code).toBeDefined();
    });

    it("setting a user back to ACTIVE does not touch refresh tokens (only suspend/delete revoke)", async () => {
      await tokenService.issueTokenPair(target);
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${target.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "ACTIVE" });
      expect(res.status).toBe(200);
      const after = await prisma.refreshToken.findMany({ where: { userId: target.id } });
      expect(after.every((t) => t.revokedAt === null)).toBe(true);
    });

    it("PATCH role/status 404 for an id that does not exist", async () => {
      const roleRes = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${randomUUID()}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.SHOP_OWNER });
      expect(roleRes.status).toBe(404);

      const statusRes = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${randomUUID()}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "SUSPENDED" });
      expect(statusRes.status).toBe(404);
    });

    it("self-lockout: an ADMIN cannot demote themselves out of ADMIN", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${admin.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.SHOP_OWNER });
      expect(res.status).toBe(403);

      const reread = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(reread?.role).toBe(UserRole.ADMIN);
    });

    it("self-lockout: an ADMIN re-affirming their own ADMIN role is allowed (no-op, not a demotion)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${admin.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.ADMIN });
      expect(res.status).toBe(200);
    });

    it("self-lockout: an ADMIN cannot suspend their own account", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${admin.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "SUSPENDED" });
      expect(res.status).toBe(403);

      const reread = await prisma.user.findUnique({ where: { id: admin.id } });
      expect(reread?.status).toBe("ACTIVE");
    });

    it("self-lockout: an ADMIN cannot delete their own account", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${admin.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "DELETED" });
      expect(res.status).toBe(403);
    });
  });

  describe("23.7 admin panel: live system summary (dashboard: recentOrders, activeUsersNow, traffic, instances)", () => {
    it("GET /v1/admin/dashboard exposes recentOrders, activeUsersNow, traffic and instances shapes", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/admin/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      expect(Array.isArray(res.body.recentOrders)).toBe(true);
      expect(res.body.recentOrders.length).toBeLessThanOrEqual(20);
      for (const row of res.body.recentOrders as Array<Record<string, unknown>>) {
        expect(row).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            publicOrderNumber: expect.any(String),
            shopName: expect.any(String),
            status: expect.any(String),
            createdAt: expect.any(String),
          }),
        );
      }

      expect(typeof res.body.activeUsersNow).toBe("number");

      expect(res.body.traffic).toEqual(
        expect.objectContaining({
          totalSinceStart: expect.any(Number),
          requestsPerMinute: expect.any(Number),
        }),
      );
      // The GET this test just made is itself a request the global counter
      // middleware (bootstrap.ts) recorded before the handler ever ran.
      expect(res.body.traffic.requestsPerMinute).toBeGreaterThanOrEqual(1);
      expect(res.body.traffic.totalSinceStart).toBeGreaterThanOrEqual(
        res.body.traffic.requestsPerMinute,
      );

      expect(res.body.instances).toEqual(
        expect.objectContaining({
          printerAgentsConnected: expect.any(Number),
          note: expect.any(String),
        }),
      );
      // Re-surfaces the exact same figure the rest of the dashboard already
      // computes, under the "instances" label -- not a separate count.
      expect(res.body.instances.printerAgentsConnected).toBe(res.body.printers.agentsActive);
      expect(res.body.instances.note.length).toBeGreaterThan(0);
    });

    it("activeUsersNow counts a distinct LOGIN actor inside the 15-minute window, and excludes one outside it", async () => {
      const before = await request(app.getHttpServer())
        .get("/v1/admin/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(before.status).toBe(200);

      const recentUser = await prisma.user.create({
        data: {
          role: UserRole.SHOP_OWNER,
          name: "Admin E2E Recent Login User",
          email: `admin-e2e-recent-login-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(recentUser.id);
      const staleUser = await prisma.user.create({
        data: {
          role: UserRole.SHOP_OWNER,
          name: "Admin E2E Stale Login User",
          email: `admin-e2e-stale-login-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(staleUser.id);

      await prisma.auditLog.create({
        data: {
          actorId: recentUser.id,
          action: AuditAction.LOGIN,
          resourceType: "admin-e2e-login-test",
          createdAt: new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          actorId: staleUser.id,
          action: AuditAction.LOGIN,
          resourceType: "admin-e2e-login-test",
          // 20 minutes ago: outside the dashboard's 15-minute "active now" window.
          createdAt: new Date(Date.now() - 20 * 60_000),
        },
      });

      const after = await request(app.getHttpServer())
        .get("/v1/admin/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(after.status).toBe(200);
      // Exactly one more distinct actor counted than the baseline: the
      // recent login, never the stale one.
      expect(after.body.activeUsersNow).toBe(before.body.activeUsersNow + 1);
    });
  });

  describe("24.1 QR guest ordering: SYSTEM-role accounts are hidden from the admin user views", () => {
    let systemUser: { id: string };

    beforeAll(async () => {
      // The shape PublicOrdersService lazily provisions per shop: a synthetic
      // account that exists only so a QR order's non-nullable customerId has
      // a real User row behind it. Created last, so newest-first listing
      // would put it on page one if it were not excluded.
      systemUser = await prisma.user.create({
        data: {
          role: UserRole.SYSTEM,
          name: "Admin E2E QR System User",
          email: `admin-e2e-qr-system-${randomUUID()}@system.print-automated.invalid`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(systemUser.id);
    });

    it("never appears in GET /admin/users", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/admin/users")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{ id: string; role: string }>;
      expect(items.map((u) => u.id)).not.toContain(systemUser.id);
      expect(items.every((u) => u.role !== UserRole.SYSTEM)).toBe(true);
    });

    it("is never counted in the dashboard's users aggregate", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/admin/dashboard")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.users.byRole).not.toHaveProperty(UserRole.SYSTEM);
    });

    it("cannot be granted through PATCH /admin/users/:id/role (400)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${owner.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.SYSTEM });
      expect(res.status).toBe(400);
      const reread = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(reread?.role).toBe(UserRole.SHOP_OWNER);
    });

    it("a SYSTEM account's own role and status cannot be changed (403)", async () => {
      const roleRes = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${systemUser.id}/role`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ role: UserRole.ADMIN });
      expect(roleRes.status).toBe(403);

      const statusRes = await request(app.getHttpServer())
        .patch(`/v1/admin/users/${systemUser.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "SUSPENDED" });
      expect(statusRes.status).toBe(403);

      const reread = await prisma.user.findUnique({ where: { id: systemUser.id } });
      expect(reread).toMatchObject({ role: UserRole.SYSTEM, status: "ACTIVE" });
    });
  });

  describe("fix wave 1: an admin-created business gets a real owner who can activate it and operate it", () => {
    /** This suite's own client IP on the public QR routes (see TRUST_PROXY_HOPS above). */
    const GUEST_IP = "198.51.100.77";
    const GUEST = { "X-Forwarded-For": GUEST_IP };

    beforeAll(async () => {
      // Only this suite's own buckets: the hour-long windows outlive a single run.
      const redis = app.get<Redis>(REDIS_CLIENT);
      const keys = await redis.keys(`ratelimit:PublicOrdersController:*${GUEST_IP}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    });
    const CONFIG = {
      pages: { mode: "all" as const },
      copies: 1,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };

    async function createBusiness(label: string, overrides: Record<string, unknown> = {}) {
      const body = businessBody(label, overrides) as ReturnType<typeof businessBody> & {
        owner: { name: string; email: string; phone?: string };
      };
      const res = await request(app.getHttpServer())
        .post("/v1/admin/businesses")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(body);
      if (res.status === 201) {
        shopIds.push(res.body.id as string);
      }
      return { res, body };
    }

    function latestCodeFor(email: string): string {
      const mail = ownerMails.filter((m) => m.email === email).at(-1);
      expect(mail).toBeDefined();
      return mail!.token;
    }

    function activate(email: string, token: string, password = "owner-chosen-password") {
      return request(app.getHttpServer())
        .post("/v1/shop/staff-invites/activate")
        .send({ email, token, password });
    }

    it("owner details are required (400), and nothing is created without them", async () => {
      const { owner: omitted, ...withoutOwner } = businessBody("No Owner");
      void omitted;
      const res = await request(app.getHttpServer())
        .post("/v1/admin/businesses")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(withoutOwner);
      expect(res.status).toBe(400);
      expect(await prisma.shop.count({ where: { name: withoutOwner.name } })).toBe(0);
    });

    it("creates the shop, the owner's SHOP_OWNER account (no password yet), an ACTIVE owner membership and a pending SHOP_OWNER invitation, and emails the owner a code -- audited", async () => {
      const { res, body } = await createBusiness("Owned");
      expect(res.status).toBe(201);
      const shopId = res.body.id as string;

      const user = await prisma.user.findUniqueOrThrow({ where: { email: body.owner.email } });
      expect(user).toMatchObject({
        role: UserRole.SHOP_OWNER,
        status: "ACTIVE",
        name: body.owner.name,
        phone: body.owner.phone,
        passwordHash: PASSWORD_NOT_SET,
      });
      expect(res.body.owner).toEqual({
        id: user.id,
        name: body.owner.name,
        email: body.owner.email,
      });

      const membership = await prisma.shopStaff.findUniqueOrThrow({
        where: { shopId_userId: { shopId, userId: user.id } },
      });
      expect(membership).toMatchObject({ role: UserRole.SHOP_OWNER, status: "ACTIVE" });

      const invite = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email: body.owner.email } },
      });
      expect(invite).toMatchObject({
        role: UserRole.SHOP_OWNER,
        invitedBy: admin.id,
        acceptedAt: null,
        revokedAt: null,
      });
      expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const code = latestCodeFor(body.owner.email);
      expect(ownerMails.at(-1)).toMatchObject({ email: body.owner.email, shopName: body.name });
      expect(invite.tokenHash).not.toBe(code); // only the hash is ever stored

      const created = await prisma.auditLog.findFirstOrThrow({
        where: { action: AuditAction.SHOP_CREATED, resourceId: shopId },
      });
      expect(created.actorId).toBe(admin.id);
      expect(created.metadata).toMatchObject({ ownerUserId: user.id });
      const invited = await prisma.auditLog.findFirstOrThrow({
        where: { action: AuditAction.SHOP_STAFF_INVITED, resourceId: shopId },
      });
      expect(invited.actorId).toBe(admin.id);
      expect(JSON.stringify(invited.metadata)).not.toContain(body.owner.email);

      const detail = await request(app.getHttpServer())
        .get(`/v1/admin/businesses/${shopId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        hasPricingRule: false,
        owner: {
          id: user.id,
          name: body.owner.name,
          email: body.owner.email,
          activationPending: true,
        },
        counts: { staff: 1 },
      });
    });

    it("the owner cannot sign in before activating (401, like any wrong password)", async () => {
      const { res, body } = await createBusiness("Not Yet Active");
      expect(res.status).toBe(201);
      for (const password of ["anything-at-all", PASSWORD_NOT_SET]) {
        const login = await request(app.getHttpServer())
          .post("/v1/auth/login")
          .send({ email: body.owner.email, password });
        expect(login.status).toBe(401);
      }
    });

    it("activation: the emailed code plus the invited address set the owner's OWN password, start a session and open the business to them; the code then stops working", async () => {
      const { res, body } = await createBusiness("Activates");
      const shopId = res.body.id as string;
      const code = latestCodeFor(body.owner.email);

      // The address is matched the way sign-in matches it (trimmed, case-insensitive).
      const activated = await activate(` ${body.owner.email.toUpperCase()}`, code);
      expect(activated.status).toBe(200);
      expect(activated.body).toMatchObject({
        user: { email: body.owner.email, role: UserRole.SHOP_OWNER },
        shopId,
        role: UserRole.SHOP_OWNER,
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });

      const me = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set("Authorization", `Bearer ${activated.body.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.shops).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: shopId, role: "SHOP_OWNER" })]),
      );

      const login = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: body.owner.email, password: "owner-chosen-password" });
      expect(login.status).toBe(200);

      const invite = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email: body.owner.email } },
      });
      expect(invite.acceptedAt).not.toBeNull();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: body.owner.email } });
      expect(
        await prisma.auditLog.count({
          where: { action: AuditAction.SHOP_STAFF_INVITE_ACCEPTED, actorId: user.id },
        }),
      ).toBe(1);

      // Single use: replaying it cannot reset the password it just set.
      expect((await activate(body.owner.email, code, "attacker-chosen-password")).status).toBe(404);
      const stillMine = await request(app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: body.owner.email, password: "owner-chosen-password" });
      expect(stillMine.status).toBe(200);

      const detail = await request(app.getHttpServer())
        .get(`/v1/admin/businesses/${shopId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(detail.body.owner.activationPending).toBe(false);
    });

    it("activation refuses with one uniform 404: a wrong code, the right code for another address, and any account that already has a password", async () => {
      const { body } = await createBusiness("Refusals");
      const code = latestCodeFor(body.owner.email);

      expect((await activate(body.owner.email, "x".repeat(43))).status).toBe(404);

      // A real invitation (as a manager would send one) to an account that HAS a
      // password: activation is not a password reset, whoever holds the code.
      const rawToken = `admin-e2e-${randomUUID()}-${randomUUID()}`;
      const { hashToken } = await import("../src/common/crypto.util.js");
      await prisma.shopStaffInvite.create({
        data: {
          shopId: shopA.id,
          email: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email,
          role: UserRole.SHOP_MANAGER,
          tokenHash: hashToken(rawToken),
          invitedBy: owner.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect((await activate(ownerRow.email, rawToken)).status).toBe(404);
      expect((await activate(ownerRow.email, code)).status).toBe(404);
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(unchanged.passwordHash).toBe(ownerRow.passwordHash);

      // None of that burned the genuine code.
      expect((await activate(body.owner.email, code)).status).toBe(200);
    });

    it("an owner email that already has an account is refused (409 OWNER_EMAIL_IN_USE) and nothing is created", async () => {
      const taken = (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email;
      const { res, body } = await createBusiness("Taken Email", {
        owner: { name: "Somebody", email: taken.toUpperCase() },
      });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("OWNER_EMAIL_IN_USE");
      expect(await prisma.shop.count({ where: { name: body.name } })).toBe(0);
    });

    it("the full journey: until its activated owner sets prices, the business refuses QR orders (409 SHOP_PRICING_NOT_CONFIGURED); after, it takes them", async () => {
      const { res, body } = await createBusiness("Journey");
      const shopId = res.body.id as string;
      const session = await activate(body.owner.email, latestCodeFor(body.owner.email));
      expect(session.status).toBe(200);
      const ownerAuth = { Authorization: `Bearer ${session.body.accessToken}` };

      const opened = await request(app.getHttpServer())
        .patch(`/v1/admin/businesses/${shopId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: ShopStatus.OPEN });
      expect(opened.status).toBe(200);

      async function qrOrder(): Promise<request.Response> {
        const bytes = Buffer.from("%PDF-1.7\nadmin e2e journey\n%%EOF");
        const created = await request(app.getHttpServer())
          .post(`/v1/public/shops/${shopId}/documents`)
          .set(GUEST)
          .send({ filename: "journey.pdf", mimeType: "application/pdf", sizeBytes: bytes.length });
        expect(created.status).toBe(201);
        const put = await fetch(created.body.uploadUrl, {
          method: "PUT",
          body: bytes,
          headers: { "Content-Type": "application/pdf" },
        });
        expect(put.ok).toBe(true);
        const confirmed = await request(app.getHttpServer())
          .post(`/v1/public/shops/${shopId}/documents/${created.body.documentId}/upload`)
          .set(GUEST);
        expect(confirmed.status).toBe(200);
        // READY by hand: the worker's scan pipeline is out of scope here.
        await prisma.document.update({
          where: { id: created.body.documentId },
          data: { status: DocumentStatus.READY, pageCount: 2 },
        });
        return request(app.getHttpServer())
          .post(`/v1/public/shops/${shopId}/orders`)
          .set(GUEST)
          .send({
            name: "Journey Guest",
            phone: "03001234567",
            documentId: created.body.documentId,
            printConfiguration: CONFIG,
          });
      }

      const refused = await qrOrder();
      expect(refused.status).toBe(409);
      expect(refused.body.error_code).toBe("SHOP_PRICING_NOT_CONFIGURED");
      const before = await request(app.getHttpServer())
        .get(`/v1/admin/businesses/${shopId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(before.body.hasPricingRule).toBe(false);

      const priced = await request(app.getHttpServer())
        .post("/v1/shop/pricing-rules")
        .set(ownerAuth)
        .send({
          shopId,
          currency: "PKR",
          pricePerPageMinor: 1000,
          colorSurchargePerPageMinor: 500,
          minimumChargeMinor: 1000,
        });
      expect(priced.status).toBe(201);
      const after = await request(app.getHttpServer())
        .get(`/v1/admin/businesses/${shopId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(after.body.hasPricingRule).toBe(true);

      const placed = await qrOrder();
      expect(placed.status).toBe(201);
      expect(placed.body).toMatchObject({ creationSource: "QR", orderStatus: "UPLOADED" });
    });

    it("an admin can re-issue the owner's code while they have not activated (the old code stops working), and never after", async () => {
      const { res, body } = await createBusiness("Reissue");
      const shopId = res.body.id as string;
      const first = latestCodeFor(body.owner.email);

      const reissued = await request(app.getHttpServer())
        .post(`/v1/admin/businesses/${shopId}/owner-invite`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(reissued.status).toBe(202);
      const second = latestCodeFor(body.owner.email);
      expect(second).not.toBe(first);

      expect((await activate(body.owner.email, first)).status).toBe(404);
      expect((await activate(body.owner.email, second)).status).toBe(200);

      const again = await request(app.getHttpServer())
        .post(`/v1/admin/businesses/${shopId}/owner-invite`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(again.status).toBe(409);
      expect(again.body.error_code).toBe("OWNER_ALREADY_ACTIVE");

      expect(
        await prisma.auditLog.count({
          where: { action: AuditAction.SHOP_STAFF_INVITED, resourceId: shopId },
        }),
      ).toBe(2);

      const notAdmin = await request(app.getHttpServer())
        .post(`/v1/admin/businesses/${shopId}/owner-invite`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(notAdmin.status).toBe(403);
    });
  });
});
