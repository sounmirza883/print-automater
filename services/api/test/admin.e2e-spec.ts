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

  it("a SHOP_OWNER gets 403 on every admin route, not elevated access", async () => {
    for (const path of [
      "/v1/admin/businesses",
      "/v1/admin/users",
      "/v1/admin/audit",
      "/v1/admin/system",
    ]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);
    }
  });

  it("no token: 401 on every admin route", async () => {
    for (const path of [
      "/v1/admin/businesses",
      "/v1/admin/users",
      "/v1/admin/audit",
      "/v1/admin/system",
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(401);
    }
  });
});
