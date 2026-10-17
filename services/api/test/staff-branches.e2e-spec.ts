import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, UserRole } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";

/** Which branch each person works at: shown on /me, the roster and pending invitations, and a
 * branch-bound person only ever sees their own branch's people. */
describe("Staff and branches (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;

  interface Member {
    userId: string;
    membershipId: string;
    token: string;
  }
  let shopId: string;
  let branchA: { id: string; name: string };
  let branchB: { id: string; name: string };
  let owner: Member;
  let managerA: Member;
  let counterA: Member;
  let counterB: Member;
  let roamingManager: Member;

  const userIds: string[] = [];
  const shopIds: string[] = [];

  async function makeMember(
    role: UserRole,
    branchId: string | null,
    name: string,
  ): Promise<Member> {
    const user = await prisma.user.create({
      data: {
        role,
        name,
        email: `staff-branches-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(user.id);
    const membership = await prisma.shopStaff.create({
      data: { shopId, userId: user.id, role, status: ShopStaffStatus.ACTIVE, branchId },
    });
    return {
      userId: user.id,
      membershipId: membership.id,
      token: tokenService.issueAccessToken(user),
    };
  }
  const as = (member: Member) => ({ Authorization: `Bearer ${member.token}` });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const shop = await prisma.shop.create({
      data: { name: `Staff Branches Shop ${randomUUID()}`, address: "1 Head Office Road" },
    });
    shopId = shop.id;
    shopIds.push(shop.id);
    branchA = await prisma.branch.findFirstOrThrow({ where: { shopId } });
    branchB = await prisma.branch.create({
      data: { shopId, name: "Second Branch", address: "2 Other Road" },
    });

    owner = await makeMember(UserRole.SHOP_OWNER, null, "Sb Owner");
    managerA = await makeMember(UserRole.SHOP_MANAGER, branchA.id, "Sb Manager A");
    counterA = await makeMember(UserRole.SHOP_COUNTER, branchA.id, "Sb Counter A");
    counterB = await makeMember(UserRole.SHOP_COUNTER, branchB.id, "Sb Counter B");
    roamingManager = await makeMember(UserRole.SHOP_MANAGER, null, "Sb Roaming Manager");

    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    for (const [label, branchId] of [
      ["a", branchA.id],
      ["b", branchB.id],
      ["all", null],
    ] as const) {
      await prisma.shopStaffInvite.create({
        data: {
          shopId,
          email: `staff-branches-e2e-invite-${label}-${randomUUID()}@print-automated.dev`,
          role: UserRole.SHOP_COUNTER,
          tokenHash: randomUUID(),
          invitedBy: owner.userId,
          expiresAt: future,
          branchId,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.shopStaffInvite.deleteMany({ where: { shopId } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  const names = (res: request.Response): string[] =>
    res.body.items.map((item: { name: string }) => item.name).sort();

  describe("/me", () => {
    it("tells a member which branch they work at, and null for all branches", async () => {
      const bound = await http().get("/v1/shop/staff/me").set(as(managerA));
      const shop = bound.body.shops.find((s: { id: string }) => s.id === shopId);
      expect(shop).toMatchObject({ branchId: branchA.id, branchName: branchA.name });

      const free = await http().get("/v1/shop/staff/me").set(as(owner));
      const ownerShop = free.body.shops.find((s: { id: string }) => s.id === shopId);
      expect(ownerShop).toMatchObject({ branchId: null, branchName: null });
    });
  });

  describe("the roster", () => {
    it("shows each person's branch", async () => {
      const res = await http().get("/v1/shop/staff").query({ shopId, limit: 100 }).set(as(owner));
      expect(res.status).toBe(200);
      const row = (member: Member) =>
        res.body.items.find((item: { id: string }) => item.id === member.membershipId);
      expect(row(counterB)).toMatchObject({ branchId: branchB.id, branchName: "Second Branch" });
      expect(row(roamingManager)).toMatchObject({ branchId: null, branchName: null });
    });

    it("gives a branch-bound manager only their own branch's people", async () => {
      const res = await http()
        .get("/v1/shop/staff")
        .query({ shopId, limit: 100 })
        .set(as(managerA));
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Sb Counter A", "Sb Manager A"]);
      expect(res.body.total).toBe(2);
    });

    it("lets an all-branches person narrow the roster to one branch", async () => {
      const res = await http()
        .get("/v1/shop/staff")
        .query({ shopId, branchId: branchB.id, limit: 100 })
        .set(as(roamingManager));
      expect(res.status).toBe(200);
      expect(names(res)).toEqual(["Sb Counter B"]);
    });

    it("refuses a branch-bound manager who asks for another branch, and allows their own", async () => {
      const other = await http()
        .get("/v1/shop/staff")
        .query({ shopId, branchId: branchB.id })
        .set(as(managerA));
      expect(other.status).toBe(403);

      const own = await http()
        .get("/v1/shop/staff")
        .query({ shopId, branchId: branchA.id, limit: 100 })
        .set(as(managerA));
      expect(own.status).toBe(200);
      expect(names(own)).toEqual(["Sb Counter A", "Sb Manager A"]);
    });
  });

  describe("the staff directory (names for pickers)", () => {
    const directory = (member: Member) =>
      http().get("/v1/shop/staff/directory").query({ shopId, limit: 100 }).set(as(member));

    it("gives a branch-bound person, whatever their role, only their own branch's people", async () => {
      for (const member of [managerA, counterA]) {
        const res = await directory(member);
        expect(res.status).toBe(200);
        expect(names(res)).toEqual(["Sb Counter A", "Sb Manager A"]);
        expect(res.body.total).toBe(2);
      }
    });

    it("gives an all-branches person everyone", async () => {
      for (const member of [owner, roamingManager]) {
        const res = await directory(member);
        expect(res.status).toBe(200);
        expect(names(res)).toEqual(
          expect.arrayContaining(["Sb Counter A", "Sb Counter B", "Sb Manager A", "Sb Owner"]),
        );
      }
    });
  });

  describe("pending invitations", () => {
    const branchesOf = (res: request.Response): Array<string | null> =>
      res.body.items.map((item: { branchId: string | null }) => item.branchId);

    it("shows each invitation's branch to an all-branches person, and can filter", async () => {
      const all = await http()
        .get("/v1/shop/staff/invites")
        .query({ shopId, limit: 50 })
        .set(as(owner));
      expect(all.status).toBe(200);
      expect(branchesOf(all)).toEqual(expect.arrayContaining([branchA.id, branchB.id, null]));
      expect(all.body.items[0]).toHaveProperty("branchName");

      const onlyB = await http()
        .get("/v1/shop/staff/invites")
        .query({ shopId, branchId: branchB.id })
        .set(as(owner));
      expect(branchesOf(onlyB)).toEqual([branchB.id]);
    });

    it("gives a branch-bound manager only their own branch's invitations", async () => {
      const res = await http()
        .get("/v1/shop/staff/invites")
        .query({ shopId, limit: 50 })
        .set(as(managerA));
      expect(res.status).toBe(200);
      expect(branchesOf(res)).toEqual([branchA.id]);
    });

    it("refuses a branch-bound manager who asks for another branch's invitations", async () => {
      const res = await http()
        .get("/v1/shop/staff/invites")
        .query({ shopId, branchId: branchB.id })
        .set(as(managerA));
      expect(res.status).toBe(403);
    });
  });
});
