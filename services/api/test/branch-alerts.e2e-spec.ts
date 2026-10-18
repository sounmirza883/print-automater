import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, UserRole } from "@prisma/client";
import { PrismaService, notifyShopStaff } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** An alert about branch A reaches the people who work at A and the people who work at all
 * branches, and nobody else; an alert with no branch (stock, until it is split by branch) reaches
 * everyone who holds the permission. The notification centre applies the same rule when reading,
 * so an alert that somehow exists for the wrong branch is never shown. */
describe("Staff alerts follow the branch (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let shopId: string;
  let branchA: { id: string };
  let branchB: { id: string };
  const userIds: string[] = [];
  const shopIds: string[] = [];

  interface Member {
    userId: string;
    token: string;
  }
  let managerA: Member;
  let managerB: Member;
  let owner: Member;
  let roamingManager: Member;
  let operatorA: Member;

  async function makeMember(role: UserRole, branchId: string | null): Promise<Member> {
    const user = await prisma.user.create({
      data: {
        role,
        name: `Alerts E2E ${role}`,
        email: `alerts-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(user.id);
    await prisma.shopStaff.create({
      data: { shopId, userId: user.id, role, status: ShopStaffStatus.ACTIVE, branchId },
    });
    return { userId: user.id, token: tokenService.issueAccessToken(user) };
  }
  const as = (member: Member) => ({ Authorization: `Bearer ${member.token}` });
  const http = () => request(app.getHttpServer());

  const alert = (branchId: string | null, targetId: string = randomUUID()) => ({
    shopId,
    branchId,
    permission: "ASSIGN_JOBS" as const,
    type: "JOB_BLOCKED" as const,
    title: "A job is blocked",
    body: "No printer is free",
    targetType: "PRINT_JOB" as const,
    targetId,
  });
  const received = (member: Member) =>
    prisma.staffNotification.count({ where: { userId: member.userId, shopId } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const shop = await prisma.shop.create({
      data: { name: `Alerts E2E Shop ${randomUUID()}`, address: "1 Road" },
    });
    shopId = shop.id;
    shopIds.push(shop.id);
    branchA = await prisma.branch.findFirstOrThrow({ where: { shopId } });
    branchB = await prisma.branch.create({
      data: { shopId, name: "Second Branch", address: "2 Road" },
    });
    managerA = await makeMember(UserRole.SHOP_MANAGER, branchA.id);
    managerB = await makeMember(UserRole.SHOP_MANAGER, branchB.id);
    owner = await makeMember(UserRole.SHOP_OWNER, null);
    roamingManager = await makeMember(UserRole.SHOP_MANAGER, null);
    operatorA = await makeMember(UserRole.OPERATOR, branchA.id);
  });

  afterAll(async () => {
    await prisma.staffNotification.deleteMany({ where: { shopId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("who is sent an alert", () => {
    it("reaches the branch's own staff and the people who work at all branches, not another branch", async () => {
      await prisma.$transaction((tx) => notifyShopStaff(tx, alert(branchA.id)));

      expect(await received(managerA)).toBe(1);
      expect(await received(operatorA)).toBe(1);
      expect(await received(owner)).toBe(1);
      expect(await received(roamingManager)).toBe(1);
      expect(await received(managerB)).toBe(0);
    });

    it("stores the branch on the alert", async () => {
      const row = await prisma.staffNotification.findFirstOrThrow({
        where: { userId: managerA.userId, shopId },
      });
      expect(row.branchId).toBe(branchA.id);
    });

    it("reaches everyone who holds the permission when the alert has no branch", async () => {
      const before = await Promise.all([managerA, managerB, owner].map(received));
      await prisma.$transaction((tx) =>
        notifyShopStaff(tx, {
          ...alert(null),
          permission: "VIEW_INVENTORY",
          type: "LOW_STOCK",
          targetType: "INVENTORY_ITEM",
        }),
      );
      const after = await Promise.all([managerA, managerB, owner].map(received));
      expect(after.map((n, i) => n - before[i]!)).toEqual([1, 1, 1]);
    });
  });

  describe("who can read an alert", () => {
    const feed = async (member: Member): Promise<string[]> => {
      const res = await http()
        .get("/v1/notifications")
        .query({ audience: "staff", shopId, limit: 100 })
        .set(as(member));
      expect(res.status).toBe(200);
      return res.body.items.map((item: { target: { id: string } | null }) => item.target?.id);
    };
    const unread = async (member: Member): Promise<number> => {
      const res = await http()
        .get("/v1/notifications/unread-count")
        .query({ shopId })
        .set(as(member));
      expect(res.status).toBe(200);
      return res.body.count;
    };

    it("never shows another branch's alert, even one that exists for that person", async () => {
      // As if it had been raised before the person moved branches: a row for B's manager about A.
      const aboutA = randomUUID();
      await prisma.staffNotification.create({
        data: {
          userId: managerB.userId,
          shopId,
          branchId: branchA.id,
          type: "JOB_BLOCKED",
          title: "About branch A",
          body: "x",
          targetType: "PRINT_JOB",
          targetId: aboutA,
        },
      });
      const aboutB = randomUUID();
      await prisma.staffNotification.create({
        data: {
          userId: managerB.userId,
          shopId,
          branchId: branchB.id,
          type: "JOB_BLOCKED",
          title: "About branch B",
          body: "x",
          targetType: "PRINT_JOB",
          targetId: aboutB,
        },
      });

      const seen = await feed(managerB);
      expect(seen).toContain(aboutB);
      expect(seen).not.toContain(aboutA);
      // Unread = their own branch's alerts plus the business-wide ones (no branch), never A's.
      expect(await unread(managerB)).toBe(
        await prisma.staffNotification.count({
          where: {
            userId: managerB.userId,
            shopId,
            readAt: null,
            OR: [{ branchId: null }, { branchId: branchB.id }],
          },
        }),
      );

      const readAll = await http()
        .post("/v1/notifications/read-all")
        .query({ shopId })
        .set(as(managerB));
      expect(readAll.status).toBe(200);
      const still = await prisma.staffNotification.findFirstOrThrow({
        where: { userId: managerB.userId, targetId: aboutA },
      });
      expect(still.readAt).toBeNull();
    });

    it("shows an all-branches person every branch's alerts", async () => {
      const seen = await feed(owner);
      const rows = await prisma.staffNotification.findMany({
        where: { userId: owner.userId, shopId },
        select: { targetId: true },
      });
      expect(seen.sort()).toEqual(rows.map((r) => r.targetId).sort());
    });

    it("shows a branch-bound person the business-wide alerts and their own branch's", async () => {
      const seen = await feed(managerA);
      const rows = await prisma.staffNotification.findMany({
        where: {
          userId: managerA.userId,
          shopId,
          OR: [{ branchId: null }, { branchId: branchA.id }],
        },
        select: { targetId: true },
      });
      expect(seen.sort()).toEqual(rows.map((r) => r.targetId).sort());
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });
});
