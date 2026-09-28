import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, AuditService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
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
    await prisma.auditLog.deleteMany({ where: { resourceType: "admin-e2e-test" } });
    await prisma.shopStaff.deleteMany({ where: { userId: owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
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
      counts: { staff: 0, orders: 0, printers: 0 },
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
});
