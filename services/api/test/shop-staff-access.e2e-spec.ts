import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** Per-person staff access: a membership's permissions are its role's defaults plus the
 * person's own overrides, enforced by the API (not just hidden in the screen). */
describe("Shop staff access overrides (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let shopId: string;

  const userIds: string[] = [];
  const shopIds: string[] = [];

  interface Member {
    userId: string;
    membershipId: string;
    token: string;
  }

  async function makeMember(
    role: UserRole,
    overrides: { extraPermissions?: string[]; removedPermissions?: string[] } = {},
  ): Promise<Member> {
    const user = await prisma.user.create({
      data: {
        role,
        name: `Access E2E ${role}`,
        email: `access-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(user.id);
    const membership = await prisma.shopStaff.create({
      data: { shopId, userId: user.id, role, status: ShopStaffStatus.ACTIVE, ...overrides },
    });
    return {
      userId: user.id,
      membershipId: membership.id,
      token: tokenService.issueAccessToken(user),
    };
  }

  const as = (member: Member) => ({ Authorization: `Bearer ${member.token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const shop = await prisma.shop.create({
      data: { name: `Access E2E Shop ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopId = shop.id;
    shopIds.push(shop.id);
  });

  afterAll(async () => {
    await prisma.agentPairingCode.deleteMany({ where: { createdBy: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("the permission guard reads the person's overrides", () => {
    it("lets a counter see stock once VIEW_INVENTORY is granted, and not before", async () => {
      const plain = await makeMember(UserRole.SHOP_COUNTER);
      const granted = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_INVENTORY"],
      });

      const denied = await request(app.getHttpServer())
        .get("/v1/shop/inventory/items")
        .query({ shopId })
        .set(as(plain));
      expect(denied.status).toBe(403);

      const allowed = await request(app.getHttpServer())
        .get("/v1/shop/inventory/items")
        .query({ shopId })
        .set(as(granted));
      expect(allowed.status).toBe(200);
    });

    it("stops a manager whose VIEW_INVENTORY was removed", async () => {
      const manager = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_INVENTORY", "MANAGE_INVENTORY"],
      });
      const res = await request(app.getHttpServer())
        .get("/v1/shop/inventory/items")
        .query({ shopId })
        .set(as(manager));
      expect(res.status).toBe(403);
    });
  });

  describe("every other place that decides a member's permissions reads the overrides", () => {
    it("lists the effective permissions on /me, so the web navigation follows", async () => {
      const counter = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_INVENTORY"],
      });
      const manager = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });

      const counterMe = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set(as(counter));
      const managerMe = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set(as(manager));

      const held = (res: request.Response): string[] =>
        res.body.shops.find((s: { id: string }) => s.id === shopId).permissions;
      expect(held(counterMe)).toContain("VIEW_INVENTORY");
      expect(held(managerMe)).not.toContain("VIEW_REPORTS");
      expect(held(managerMe)).toContain("VIEW_ORDERS");
    });

    it("lets an operator granted MANAGE_PRINTERS issue a pairing code (the role list no longer blocks it)", async () => {
      const operator = await makeMember(UserRole.OPERATOR, {
        extraPermissions: ["MANAGE_PRINTERS"],
      });
      const res = await request(app.getHttpServer())
        .post("/v1/shop/agents/pairing-code")
        .set(as(operator))
        .send({ shopId });
      expect(res.status).toBe(201);
    });

    it("applies the person's MANAGE_AUTOMATION to settings changes", async () => {
      const stripped = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["MANAGE_AUTOMATION"],
      });
      const granted = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_SETTINGS", "MANAGE_AUTOMATION"],
      });
      const body = { shopId, inventoryAlertsEnabled: true };

      const refused = await request(app.getHttpServer())
        .put("/v1/shop/settings")
        .set(as(stripped))
        .send(body);
      expect(refused.status).toBe(403);

      const accepted = await request(app.getHttpServer())
        .put("/v1/shop/settings")
        .set(as(granted))
        .send(body);
      expect(accepted.status).toBe(200);
    });
  });
});
