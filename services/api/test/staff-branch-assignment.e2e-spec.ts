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
import { NotificationService } from "../src/notifications/notification.service.js";

/** Putting people into branches: who may assign whom where, that a branch-bound person cannot
 * reach another branch's people, and how invitations carry the branch to acceptance. */
describe("Staff branch assignment (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  const sent: Array<{ email: string; token: string | null }> = [];

  interface Member {
    userId: string;
    membershipId: string;
    token: string;
  }
  let shopId: string;
  let branchA: { id: string };
  let branchB: { id: string };
  let owner: Member;
  let managerA: Member;
  let roamingManager: Member;

  const userIds: string[] = [];
  const shopIds: string[] = [];

  async function makeUser(role: UserRole, email?: string) {
    const user = await prisma.user.create({
      data: {
        role,
        name: `Assign E2E ${role}`,
        email: email ?? `assign-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function makeMember(
    role: UserRole,
    branchId: string | null,
    forShop: string = shopId,
  ): Promise<Member> {
    const user = await makeUser(role);
    const membership = await prisma.shopStaff.create({
      data: { shopId: forShop, userId: user.id, role, status: ShopStaffStatus.ACTIVE, branchId },
    });
    return {
      userId: user.id,
      membershipId: membership.id,
      token: tokenService.issueAccessToken(user),
    };
  }
  async function makeShop(label: string) {
    const shop = await prisma.shop.create({
      data: { name: `Assign E2E ${label} ${randomUUID()}`, address: "1 Road" },
    });
    shopIds.push(shop.id);
    return shop;
  }
  const as = (member: Member) => ({ Authorization: `Bearer ${member.token}` });
  const http = () => request(app.getHttpServer());
  const freshEmail = () => `assign-e2e-invitee-${randomUUID()}@print-automated.dev`;

  const invite = (
    actor: Member,
    body: { email?: string; role?: string; branchId?: string | null; shopId?: string },
  ) =>
    http()
      .post("/v1/shop/staff")
      .set(as(actor))
      .send({ shopId, email: freshEmail(), role: "SHOP_COUNTER", ...body });

  /** The emailed code for an address, accepted by an account holding that address. */
  async function accept(email: string) {
    const token = sent.filter((mail) => mail.email === email).at(-1)!.token!;
    const user = await makeUser(UserRole.CUSTOMER, email);
    const res = await http()
      .post("/v1/shop/staff-invites/accept")
      .set({ Authorization: `Bearer ${tokenService.issueAccessToken(user)}` })
      .send({ token });
    return { res, userId: user.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationService)
      .useValue({
        sendStaffInvite: async (
          email: string,
          _shop: string,
          _role: string,
          token: string | null,
        ) => {
          sent.push({ email, token });
        },
        sendPasswordRecovery: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    const shop = await makeShop("multi");
    shopId = shop.id;
    branchA = await prisma.branch.findFirstOrThrow({ where: { shopId } });
    branchB = await prisma.branch.create({
      data: { shopId, name: "Second Branch", address: "2 Other Road" },
    });
    owner = await makeMember(UserRole.SHOP_OWNER, null);
    managerA = await makeMember(UserRole.SHOP_MANAGER, branchA.id);
    roamingManager = await makeMember(UserRole.SHOP_MANAGER, null);
  });

  afterAll(async () => {
    await prisma.shopStaffInvite.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("inviting", () => {
    it("lets an owner invite someone into a branch, and they land there when they accept", async () => {
      const email = freshEmail();
      const res = await invite(owner, { email, branchId: branchB.id });
      expect(res.status).toBe(202);
      const pending = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email } },
      });
      expect(pending.branchId).toBe(branchB.id);

      const accepted = await accept(email);
      expect(accepted.res.status).toBe(200);
      const membership = await prisma.shopStaff.findUniqueOrThrow({
        where: { shopId_userId: { shopId, userId: accepted.userId } },
      });
      expect(membership.branchId).toBe(branchB.id);
    });

    it("uses the only branch when none is named, and asks when there are several", async () => {
      const single = await makeShop("single");
      const singleOwner = await makeMember(UserRole.SHOP_OWNER, null, single.id);
      const onlyBranch = await prisma.branch.findFirstOrThrow({ where: { shopId: single.id } });

      const email = freshEmail();
      const ok = await invite(singleOwner, { shopId: single.id, email });
      expect(ok.status).toBe(202);
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: single.id, email } },
      });
      expect(row.branchId).toBe(onlyBranch.id);

      const many = await invite(owner, {});
      expect(many.status).toBe(400);
      expect(many.body.error_code).toBe("BRANCH_REQUIRED");
    });

    it("lets only an owner invite someone for all branches", async () => {
      const email = freshEmail();
      expect((await invite(owner, { email, branchId: null })).status).toBe(202);
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email } },
      });
      expect(row.branchId).toBeNull();

      expect((await invite(managerA, { branchId: null })).status).toBe(403);
      // A manager who happens to work at all branches is still not an owner.
      expect((await invite(roamingManager, { branchId: null })).status).toBe(403);
    });

    it("keeps a branch-bound manager to their own branch", async () => {
      const own = freshEmail();
      expect((await invite(managerA, { email: own, branchId: branchA.id })).status).toBe(202);

      const elsewhere = await invite(managerA, { branchId: branchB.id });
      expect(elsewhere.status).toBe(403);

      const omitted = freshEmail();
      expect((await invite(managerA, { email: omitted })).status).toBe(202);
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email: omitted } },
      });
      expect(row.branchId).toBe(branchA.id);
    });

    it("never gives an owner a branch", async () => {
      const email = freshEmail();
      expect(
        (await invite(owner, { email, role: "SHOP_OWNER", branchId: branchA.id })).status,
      ).toBe(202);
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email } },
      });
      expect(row.branchId).toBeNull();
    });

    it("refuses a branch of another business, and an archived branch", async () => {
      const otherShop = await makeShop("other");
      const foreign = await prisma.branch.findFirstOrThrow({ where: { shopId: otherShop.id } });
      expect((await invite(owner, { branchId: foreign.id })).status).toBe(400);

      const spare = await prisma.branch.create({
        data: { shopId, name: `Spare ${randomUUID()}`, address: "3 Spare Road" },
      });
      await http().post(`/v1/shop/branches/${spare.id}/archive`).set(as(owner));
      const res = await invite(owner, { branchId: spare.id });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("BRANCH_ARCHIVED");
    });

    it("does not let an invitation land in a branch that was archived before it was accepted", async () => {
      const doomed = await prisma.branch.create({
        data: { shopId, name: `Doomed ${randomUUID()}`, address: "4 Doomed Road" },
      });
      const email = freshEmail();
      expect((await invite(owner, { email, branchId: doomed.id })).status).toBe(202);
      expect(
        (await http().post(`/v1/shop/branches/${doomed.id}/archive`).set(as(owner))).status,
      ).toBe(200);

      const accepted = await accept(email);
      expect(accepted.res.status).toBe(404);
      const membership = await prisma.shopStaff.findUnique({
        where: { shopId_userId: { shopId, userId: accepted.userId } },
      });
      expect(membership).toBeNull();
    });

    it("stops a branch-bound manager from replacing or cancelling another branch's invitation", async () => {
      const email = freshEmail();
      expect((await invite(owner, { email, branchId: branchB.id })).status).toBe(202);
      const pending = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email } },
      });

      const replace = await invite(managerA, { email, branchId: branchA.id });
      expect(replace.status).toBe(403);
      const cancel = await http().delete(`/v1/shop/staff/invites/${pending.id}`).set(as(managerA));
      expect(cancel.status).toBe(403);
      const still = await prisma.shopStaffInvite.findUniqueOrThrow({ where: { id: pending.id } });
      expect(still.revokedAt).toBeNull();
      expect(still.branchId).toBe(branchB.id);

      const mine = freshEmail();
      await invite(managerA, { email: mine });
      const own = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId, email: mine } },
      });
      expect(
        (await http().delete(`/v1/shop/staff/invites/${own.id}`).set(as(managerA))).status,
      ).toBe(204);
    });
  });

  describe("adding someone directly", () => {
    const add = (actor: Member, userId: string, body: Record<string, unknown> = {}) =>
      http()
        .post("/v1/shop/staff")
        .set(as(actor))
        .send({ shopId, userId, role: "SHOP_COUNTER", ...body });

    it("puts them in the chosen branch, within what the actor may do", async () => {
      const first = await makeUser(UserRole.CUSTOMER);
      const res = await add(owner, first.id, { branchId: branchB.id });
      expect(res.status).toBe(201);
      const row = await prisma.shopStaff.findUniqueOrThrow({
        where: { shopId_userId: { shopId, userId: first.id } },
      });
      expect(row.branchId).toBe(branchB.id);

      const second = await makeUser(UserRole.CUSTOMER);
      expect((await add(managerA, second.id, { branchId: branchB.id })).status).toBe(403);
      expect(
        await prisma.shopStaff.findUnique({
          where: { shopId_userId: { shopId, userId: second.id } },
        }),
      ).toBeNull();
      expect((await add(managerA, second.id, { branchId: branchA.id })).status).toBe(201);
    });
  });

  describe("people in another branch are out of reach", () => {
    it("refuses a branch-bound manager on every way of changing a person of another branch", async () => {
      const inB = await makeMember(UserRole.SHOP_COUNTER, branchB.id);
      const roamer = await makeMember(UserRole.SHOP_COUNTER, null);

      for (const target of [inB, roamer]) {
        const access = await http()
          .patch(`/v1/shop/staff/${target.membershipId}`)
          .set(as(managerA))
          .send({ permissions: ["VIEW_ORDERS"] });
        expect(access.status).toBe(403);
        const role = await http()
          .patch(`/v1/shop/staff/${target.membershipId}/role`)
          .set(as(managerA))
          .send({ role: "OPERATOR" });
        expect(role.status).toBe(403);
        const move = await http()
          .patch(`/v1/shop/staff/${target.membershipId}`)
          .set(as(managerA))
          .send({ branchId: branchA.id });
        expect(move.status).toBe(403);
        const remove = await http()
          .delete(`/v1/shop/staff/${target.membershipId}`)
          .set(as(managerA));
        expect(remove.status).toBe(403);
      }
      const after = await prisma.shopStaff.findUniqueOrThrow({ where: { id: inB.membershipId } });
      expect(after).toMatchObject({ role: "SHOP_COUNTER", branchId: branchB.id, status: "ACTIVE" });
      const roamerAfter = await prisma.shopStaff.findUniqueOrThrow({
        where: { id: roamer.membershipId },
      });
      expect(roamerAfter).toMatchObject({ branchId: null, status: "ACTIVE" });
    });

    it("still lets that manager run their own branch's people", async () => {
      const mine = await makeMember(UserRole.SHOP_COUNTER, branchA.id);
      const role = await http()
        .patch(`/v1/shop/staff/${mine.membershipId}/role`)
        .set(as(managerA))
        .send({ role: "OPERATOR" });
      expect(role.status).toBe(200);
      const access = await http()
        .patch(`/v1/shop/staff/${mine.membershipId}`)
        .set(as(managerA))
        .send({ permissions: ["VIEW_ORDERS", "VIEW_PRINTERS", "VIEW_STAFF_DIRECTORY"] });
      expect(access.status).toBe(200);
    });
  });

  describe("moving someone to another branch", () => {
    it("lets an owner move a person, and audits it", async () => {
      const person = await makeMember(UserRole.SHOP_COUNTER, branchA.id);
      const res = await http()
        .patch(`/v1/shop/staff/${person.membershipId}`)
        .set(as(owner))
        .send({ branchId: branchB.id });
      expect(res.status).toBe(200);
      expect(res.body.branchId).toBe(branchB.id);

      const row = await prisma.shopStaff.findUniqueOrThrow({ where: { id: person.membershipId } });
      expect(row.branchId).toBe(branchB.id);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "SHOP_STAFF_BRANCH_CHANGED", resourceId: person.membershipId },
      });
      expect(audit.actorId).toBe(owner.userId);
      const metadata = audit.metadata as { before: string | null; after: string | null };
      expect(metadata.before).toBe(branchA.id);
      expect(metadata.after).toBe(branchB.id);
    });

    it("lets an owner mark a non-owner as all branches, and refuses a branch-bound manager doing it or moving anyone", async () => {
      const person = await makeMember(UserRole.SHOP_COUNTER, branchA.id);
      const free = await http()
        .patch(`/v1/shop/staff/${person.membershipId}`)
        .set(as(owner))
        .send({ branchId: null });
      expect(free.status).toBe(200);
      expect(free.body.branchId).toBeNull();

      const mine = await makeMember(UserRole.SHOP_COUNTER, branchA.id);
      const toAll = await http()
        .patch(`/v1/shop/staff/${mine.membershipId}`)
        .set(as(managerA))
        .send({ branchId: null });
      expect(toAll.status).toBe(403);
      const toB = await http()
        .patch(`/v1/shop/staff/${mine.membershipId}`)
        .set(as(managerA))
        .send({ branchId: branchB.id });
      expect(toB.status).toBe(403);
      expect(
        (await prisma.shopStaff.findUniqueOrThrow({ where: { id: mine.membershipId } })).branchId,
      ).toBe(branchA.id);
    });

    it("does not change anything when the branch is the same", async () => {
      const person = await makeMember(UserRole.SHOP_COUNTER, branchA.id);
      const res = await http()
        .patch(`/v1/shop/staff/${person.membershipId}`)
        .set(as(owner))
        .send({ branchId: branchA.id });
      expect(res.status).toBe(200);
      const audits = await prisma.auditLog.count({
        where: { action: "SHOP_STAFF_BRANCH_CHANGED", resourceId: person.membershipId },
      });
      expect(audits).toBe(0);
    });

    it("never gives an owner a branch", async () => {
      const otherOwner = await makeMember(UserRole.SHOP_OWNER, null);
      const res = await http()
        .patch(`/v1/shop/staff/${otherOwner.membershipId}`)
        .set(as(owner))
        .send({ branchId: branchA.id });
      expect(res.status).toBe(403);
    });

    it("clears the branch when someone becomes an owner, and keeps all branches when an owner steps down", async () => {
      const person = await makeMember(UserRole.SHOP_COUNTER, branchB.id);
      const up = await http()
        .patch(`/v1/shop/staff/${person.membershipId}/role`)
        .set(as(owner))
        .send({ role: "SHOP_OWNER" });
      expect(up.status).toBe(200);
      expect(
        (await prisma.shopStaff.findUniqueOrThrow({ where: { id: person.membershipId } })).branchId,
      ).toBeNull();

      const down = await http()
        .patch(`/v1/shop/staff/${person.membershipId}/role`)
        .set(as(owner))
        .send({ role: "SHOP_MANAGER" });
      expect(down.status).toBe(200);
      expect(
        (await prisma.shopStaff.findUniqueOrThrow({ where: { id: person.membershipId } })).branchId,
      ).toBeNull();
    });
  });
});
