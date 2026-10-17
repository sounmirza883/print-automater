import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, ROLE_PERMISSIONS, notifyShopStaff } from "@print-automated/backend-shared";
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
    await prisma.staffNotification.deleteMany({ where: { userId: { in: userIds } } });
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

  describe("staff alerts follow the person's own access", () => {
    const lowStock = (): Parameters<typeof notifyShopStaff>[1] => ({
      shopId,
      permission: "VIEW_INVENTORY",
      type: "LOW_STOCK",
      title: "Low stock",
      body: "Paper is running low",
      targetType: "INVENTORY_ITEM",
      targetId: randomUUID(),
    });
    const alertsFor = (member: Member) =>
      prisma.staffNotification.count({ where: { userId: member.userId, shopId } });

    it("raises a low-stock alert for everyone who holds VIEW_INVENTORY, overrides included", async () => {
      const manager = await makeMember(UserRole.SHOP_MANAGER);
      const strippedOperator = await makeMember(UserRole.OPERATOR, {
        removedPermissions: ["VIEW_INVENTORY"],
      });
      const grantedCounter = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_INVENTORY"],
      });
      const plainCounter = await makeMember(UserRole.SHOP_COUNTER);

      await prisma.$transaction((tx) => notifyShopStaff(tx, lowStock()));

      expect(await alertsFor(manager)).toBe(1);
      expect(await alertsFor(grantedCounter)).toBe(1);
      expect(await alertsFor(strippedOperator)).toBe(0);
      expect(await alertsFor(plainCounter)).toBe(0);
    });

    it("hides an alert already raised once the person loses the permission, and shows it to a person who gains it", async () => {
      const operator = await makeMember(UserRole.OPERATOR);
      const counter = await makeMember(UserRole.SHOP_COUNTER);
      await prisma.$transaction((tx) => notifyShopStaff(tx, lowStock()));
      // Raised for the operator only; give the counter a copy as if they had held it then.
      await prisma.staffNotification.create({
        data: {
          userId: counter.userId,
          shopId,
          type: "LOW_STOCK",
          title: "Low stock",
          body: "Paper is running low",
          targetType: "INVENTORY_ITEM",
          targetId: randomUUID(),
        },
      });
      const feed = async (member: Member): Promise<number> => {
        const res = await request(app.getHttpServer())
          .get("/v1/notifications")
          .query({ audience: "staff", shopId })
          .set(as(member));
        expect(res.status).toBe(200);
        return res.body.items.length;
      };
      expect(await feed(operator)).toBe(1);
      expect(await feed(counter)).toBe(0);

      await prisma.shopStaff.update({
        where: { id: operator.membershipId },
        data: { removedPermissions: ["VIEW_INVENTORY"] },
      });
      await prisma.shopStaff.update({
        where: { id: counter.membershipId },
        data: { extraPermissions: ["VIEW_INVENTORY"] },
      });
      expect(await feed(operator)).toBe(0);
      expect(await feed(counter)).toBe(1);

      const readAll = await request(app.getHttpServer())
        .post("/v1/notifications/read-all")
        .query({ shopId })
        .set(as(operator));
      expect(readAll.body.updated).toBe(0);
    });
  });

  describe("the roster", () => {
    it("lists each person's permissions, their role's defaults, and whether they are customised", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const plain = await makeMember(UserRole.SHOP_COUNTER);
      const custom = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_INVENTORY"],
      });

      const res = await request(app.getHttpServer())
        .get("/v1/shop/staff")
        .query({ shopId, limit: 100 })
        .set(as(owner));
      expect(res.status).toBe(200);
      const row = (member: Member) =>
        res.body.items.find((item: { id: string }) => item.id === member.membershipId);

      expect(row(plain).customised).toBe(false);
      expect(row(plain).defaultPermissions).toEqual([...ROLE_PERMISSIONS.SHOP_COUNTER]);
      expect(row(custom).customised).toBe(true);
      expect(row(custom).permissions).toContain("VIEW_INVENTORY");
      expect(row(custom).defaultPermissions).not.toContain("VIEW_INVENTORY");
    });
  });

  describe("editing a person's access (PATCH /v1/shop/staff/:id)", () => {
    const edit = (actor: Member, target: Member, permissions: string[]) =>
      request(app.getHttpServer())
        .patch(`/v1/shop/staff/${target.membershipId}`)
        .set(as(actor))
        .send({ permissions });
    const counterDefaults = (): string[] => [...ROLE_PERMISSIONS.SHOP_COUNTER];

    it("lets an owner tick a permission on for a counter, and it takes effect", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const counter = await makeMember(UserRole.SHOP_COUNTER);

      const res = await edit(owner, counter, [...counterDefaults(), "VIEW_INVENTORY"]);
      expect(res.status).toBe(200);
      expect(res.body.permissions).toContain("VIEW_INVENTORY");

      const stored = await prisma.shopStaff.findUniqueOrThrow({
        where: { id: counter.membershipId },
      });
      expect(stored.extraPermissions).toEqual(["VIEW_INVENTORY"]);
      expect(stored.removedPermissions).toEqual([]);

      const stock = await request(app.getHttpServer())
        .get("/v1/shop/inventory/items")
        .query({ shopId })
        .set(as(counter));
      expect(stock.status).toBe(200);
    });

    it("lets an owner take a permission away from a manager", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const manager = await makeMember(UserRole.SHOP_MANAGER);
      const without = ROLE_PERMISSIONS.SHOP_MANAGER.filter((p) => p !== "VIEW_REPORTS");

      expect((await edit(owner, manager, [...without])).status).toBe(200);
      const stored = await prisma.shopStaff.findUniqueOrThrow({
        where: { id: manager.membershipId },
      });
      expect(stored.removedPermissions).toEqual(["VIEW_REPORTS"]);
    });

    it("does not let anyone edit their own access", async () => {
      const manager = await makeMember(UserRole.SHOP_MANAGER);
      const res = await edit(manager, manager, [...ROLE_PERMISSIONS.SHOP_MANAGER]);
      expect(res.status).toBe(403);
    });

    it("does not let anyone edit an owner's access", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const otherOwner = await makeMember(UserRole.SHOP_OWNER);
      const res = await edit(owner, otherOwner, [...ROLE_PERMISSIONS.SHOP_OWNER]);
      expect(res.status).toBe(403);
    });

    it("does not let a manager grant a permission they do not hold themselves", async () => {
      const manager = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });
      const counter = await makeMember(UserRole.SHOP_COUNTER);
      const res = await edit(manager, counter, [...counterDefaults(), "VIEW_REPORTS"]);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("VIEW_REPORTS");
    });

    it("lets an editor keep a permission the person already had even if the editor lacks it", async () => {
      const manager = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });
      const counter = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_REPORTS"],
      });
      const res = await edit(manager, counter, [
        ...counterDefaults(),
        "VIEW_REPORTS",
        "VIEW_INVENTORY",
      ]);
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(
        expect.arrayContaining(["VIEW_REPORTS", "VIEW_INVENTORY"]),
      );
    });

    it("never grants business settings to a non-owner", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const manager = await makeMember(UserRole.SHOP_MANAGER);
      const res = await edit(owner, manager, [...ROLE_PERMISSIONS.SHOP_MANAGER, "MANAGE_SETTINGS"]);
      expect(res.status).toBe(403);
    });

    it("grants VIEW_INVENTORY along with MANAGE_INVENTORY", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const counter = await makeMember(UserRole.SHOP_COUNTER);
      const res = await edit(owner, counter, [...counterDefaults(), "MANAGE_INVENTORY"]);
      expect(res.status).toBe(200);
      expect(res.body.permissions).toEqual(
        expect.arrayContaining(["MANAGE_INVENTORY", "VIEW_INVENTORY"]),
      );
    });

    it("refuses someone with no access to the staff page", async () => {
      const counter = await makeMember(UserRole.SHOP_COUNTER);
      const other = await makeMember(UserRole.SHOP_COUNTER);
      expect((await edit(counter, other, counterDefaults())).status).toBe(403);
    });

    it("writes SHOP_STAFF_ACCESS_CHANGED with what the access was and became", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const counter = await makeMember(UserRole.SHOP_COUNTER);
      await edit(owner, counter, [...counterDefaults(), "VIEW_INVENTORY"]);

      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: "SHOP_STAFF_ACCESS_CHANGED", resourceId: counter.membershipId },
      });
      const metadata = row.metadata as {
        before: { extraPermissions: string[]; removedPermissions: string[] };
        after: { extraPermissions: string[]; removedPermissions: string[] };
      };
      expect(row.actorId).toBe(owner.userId);
      expect(metadata.before.extraPermissions).toEqual([]);
      expect(metadata.after.extraPermissions).toEqual(["VIEW_INVENTORY"]);
    });
  });

  describe("changing a role and inviting never hand out access the actor lacks", () => {
    it("clears a person's custom access when their role changes", async () => {
      const owner = await makeMember(UserRole.SHOP_OWNER);
      const counter = await makeMember(UserRole.SHOP_COUNTER, {
        extraPermissions: ["VIEW_INVENTORY"],
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/shop/staff/${counter.membershipId}/role`)
        .set(as(owner))
        .send({ role: "OPERATOR" });
      expect(res.status).toBe(200);

      const stored = await prisma.shopStaff.findUniqueOrThrow({
        where: { id: counter.membershipId },
      });
      expect(stored.role).toBe("OPERATOR");
      expect(stored.extraPermissions).toEqual([]);
      expect(stored.removedPermissions).toEqual([]);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "SHOP_STAFF_ROLE_CHANGED", resourceId: counter.membershipId },
      });
      expect((audit.metadata as { accessReset?: boolean }).accessReset).toBe(true);
    });

    it("stops a manager who lost VIEW_REPORTS from promoting someone to manager", async () => {
      const limited = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });
      const counter = await makeMember(UserRole.SHOP_COUNTER);

      const res = await request(app.getHttpServer())
        .patch(`/v1/shop/staff/${counter.membershipId}/role`)
        .set(as(limited))
        .send({ role: "SHOP_MANAGER" });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("VIEW_REPORTS");
      const stored = await prisma.shopStaff.findUniqueOrThrow({
        where: { id: counter.membershipId },
      });
      expect(stored.role).toBe("SHOP_COUNTER");
    });

    it("stops the same manager from inviting a new manager", async () => {
      const limited = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });
      const res = await request(app.getHttpServer())
        .post("/v1/shop/staff")
        .set(as(limited))
        .send({
          shopId,
          email: `access-e2e-invitee-${randomUUID()}@print-automated.dev`,
          role: "SHOP_MANAGER",
        });
      expect(res.status).toBe(403);
    });

    it("still lets that manager invite a counter, whose defaults they hold", async () => {
      const limited = await makeMember(UserRole.SHOP_MANAGER, {
        removedPermissions: ["VIEW_REPORTS"],
      });
      const email = `access-e2e-invitee-${randomUUID()}@print-automated.dev`;
      const res = await request(app.getHttpServer())
        .post("/v1/shop/staff")
        .set(as(limited))
        .send({ shopId, email, role: "SHOP_COUNTER" });
      expect(res.status).toBe(202);
      await prisma.shopStaffInvite.deleteMany({ where: { shopId, email } });
    });
  });
});
