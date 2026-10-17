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

/** Branches live inside one business. Every shop always has at least its first branch: a
 * migration backfilled the existing ones and a trigger creates one for every new shop, so older
 * code that only inserts a shop keeps working. */
describe("Branches (e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  const shopIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("schema", () => {
    it("gives every new shop exactly one open branch named after it", async () => {
      const shop = await prisma.shop.create({
        data: {
          name: `Branch E2E Shop ${randomUUID()}`,
          address: "12 Main Street",
          phone: "0300 1234567",
          status: ShopStatus.CLOSED,
        },
      });
      shopIds.push(shop.id);

      const branches = await prisma.branch.findMany({ where: { shopId: shop.id } });
      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({
        name: shop.name,
        address: "12 Main Street",
        phone: "0300 1234567",
        isOpen: true,
        archivedAt: null,
      });
    });

    it("backfilled a branch for shops that existed before branches", async () => {
      const withoutBranch = await prisma.shop.count({ where: { branches: { none: {} } } });
      expect(withoutBranch).toBe(0);
    });

    it("refuses a staff row that points at another shop's branch", async () => {
      const shopA = await prisma.shop.create({
        data: { name: `Branch E2E A ${randomUUID()}`, address: "1" },
      });
      const shopB = await prisma.shop.create({
        data: { name: `Branch E2E B ${randomUUID()}`, address: "2" },
      });
      shopIds.push(shopA.id, shopB.id);
      const branchOfB = await prisma.branch.findFirstOrThrow({ where: { shopId: shopB.id } });
      const user = await prisma.user.create({
        data: {
          role: UserRole.SHOP_COUNTER,
          name: "Branch E2E Counter",
          email: `branch-e2e-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);

      await expect(
        prisma.shopStaff.create({
          data: {
            shopId: shopA.id,
            userId: user.id,
            role: UserRole.SHOP_COUNTER,
            status: ShopStaffStatus.ACTIVE,
            branchId: branchOfB.id,
          },
        }),
      ).rejects.toThrow();
    });

    it("lets staff rows exist with no branch (meaning all branches)", async () => {
      const shop = await prisma.shop.create({
        data: { name: `Branch E2E C ${randomUUID()}`, address: "3" },
      });
      shopIds.push(shop.id);
      const user = await prisma.user.create({
        data: {
          role: UserRole.SHOP_COUNTER,
          name: "Branch E2E Roamer",
          email: `branch-e2e-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);
      const row = await prisma.shopStaff.create({
        data: {
          shopId: shop.id,
          userId: user.id,
          role: UserRole.SHOP_COUNTER,
          status: ShopStaffStatus.ACTIVE,
        },
      });
      expect(row.branchId).toBeNull();
    });
  });

  describe("API", () => {
    interface Member {
      userId: string;
      membershipId: string;
      token: string;
    }
    let shopId: string;
    let mainBranchId: string;
    let owner: Member;
    let otherOwner: Member;

    async function makeMember(
      forShop: string,
      role: UserRole,
      branchId: string | null = null,
    ): Promise<Member> {
      const user = await prisma.user.create({
        data: {
          role,
          name: `Branch API ${role}`,
          email: `branch-e2e-${randomUUID()}@print-automated.dev`,
          passwordHash: "irrelevant",
        },
      });
      userIds.push(user.id);
      const membership = await prisma.shopStaff.create({
        data: {
          shopId: forShop,
          userId: user.id,
          role,
          status: ShopStaffStatus.ACTIVE,
          branchId,
        },
      });
      return {
        userId: user.id,
        membershipId: membership.id,
        token: tokenService.issueAccessToken(user),
      };
    }
    const as = (member: Member) => ({ Authorization: `Bearer ${member.token}` });
    const http = () => request(app.getHttpServer());

    async function createBranch(actor: Member, body: Record<string, unknown> = {}) {
      return http()
        .post("/v1/shop/branches")
        .set(as(actor))
        .send({ shopId, name: `Branch ${randomUUID()}`, address: "5 Side Street", ...body });
    }

    beforeAll(async () => {
      const shop = await prisma.shop.create({
        data: { name: `Branch API Shop ${randomUUID()}`, address: "1 Head Office Road" },
      });
      shopId = shop.id;
      shopIds.push(shop.id);
      mainBranchId = (await prisma.branch.findFirstOrThrow({ where: { shopId } })).id;
      owner = await makeMember(shopId, UserRole.SHOP_OWNER);

      const otherShop = await prisma.shop.create({
        data: { name: `Branch API Other ${randomUUID()}`, address: "9 Elsewhere" },
      });
      shopIds.push(otherShop.id);
      otherOwner = await makeMember(otherShop.id, UserRole.SHOP_OWNER);
    });

    it("lets an owner create, list, edit and archive a branch", async () => {
      const created = await createBranch(owner, {
        name: "Gulberg",
        city: "Lahore",
        phone: "0300 111",
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        shopId,
        name: "Gulberg",
        city: "Lahore",
        address: "5 Side Street",
        phone: "0300 111",
        isOpen: true,
        archivedAt: null,
        staffCount: 0,
        managers: [],
      });

      const list = await http().get("/v1/shop/branches").query({ shopId }).set(as(owner));
      expect(list.status).toBe(200);
      expect(list.body.map((b: { name: string }) => b.name)).toEqual(
        expect.arrayContaining(["Gulberg"]),
      );

      const edited = await http()
        .patch(`/v1/shop/branches/${created.body.id}`)
        .set(as(owner))
        .send({ name: "Gulberg III", address: "7 New Road", phone: null });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({
        name: "Gulberg III",
        address: "7 New Road",
        phone: null,
      });

      const archived = await http()
        .post(`/v1/shop/branches/${created.body.id}/archive`)
        .set(as(owner));
      expect(archived.status).toBe(200);
      expect(archived.body.archivedAt).not.toBeNull();

      const without = await http().get("/v1/shop/branches").query({ shopId }).set(as(owner));
      expect(without.body.map((b: { id: string }) => b.id)).not.toContain(created.body.id);
      const withArchived = await http()
        .get("/v1/shop/branches")
        .query({ shopId, includeArchived: "true" })
        .set(as(owner));
      expect(withArchived.body.map((b: { id: string }) => b.id)).toContain(created.body.id);
    });

    it("refuses a second branch with the same name in a business", async () => {
      await createBranch(owner, { name: "Twin" });
      const again = await createBranch(owner, { name: "Twin" });
      expect(again.status).toBe(409);
      expect(again.body.error_code).toBe("BRANCH_NAME_TAKEN");
    });

    it("only an owner may create, edit or archive branches", async () => {
      const manager = await makeMember(shopId, UserRole.SHOP_MANAGER, mainBranchId);
      const counter = await makeMember(shopId, UserRole.SHOP_COUNTER, mainBranchId);
      const target = await createBranch(owner);

      expect((await createBranch(manager)).status).toBe(403);
      expect((await createBranch(counter)).status).toBe(403);
      expect(
        (
          await http()
            .patch(`/v1/shop/branches/${target.body.id}`)
            .set(as(manager))
            .send({ name: "x" })
        ).status,
      ).toBe(403);
      expect(
        (await http().post(`/v1/shop/branches/${target.body.id}/archive`).set(as(manager))).status,
      ).toBe(403);
    });

    it("keeps one business's owner out of another's branches", async () => {
      const mine = await createBranch(owner);
      const read = await http().get("/v1/shop/branches").query({ shopId }).set(as(otherOwner));
      expect(read.status).toBe(403);
      expect((await createBranch(otherOwner)).status).toBe(403);
      expect(
        (
          await http()
            .patch(`/v1/shop/branches/${mine.body.id}`)
            .set(as(otherOwner))
            .send({ name: "x" })
        ).status,
      ).toBe(403);
    });

    it("lets a branch's own manager open or close it, but not another branch", async () => {
      const mineB = await createBranch(owner);
      const otherB = await createBranch(owner);
      const manager = await makeMember(shopId, UserRole.SHOP_MANAGER, mineB.body.id);

      const closed = await http()
        .put(`/v1/shop/branches/${mineB.body.id}/open-state`)
        .set(as(manager))
        .send({ isOpen: false });
      expect(closed.status).toBe(200);
      expect(closed.body.isOpen).toBe(false);

      const refused = await http()
        .put(`/v1/shop/branches/${otherB.body.id}/open-state`)
        .set(as(manager))
        .send({ isOpen: false });
      expect(refused.status).toBe(403);
      expect(
        (await prisma.branch.findUniqueOrThrow({ where: { id: otherB.body.id } })).isOpen,
      ).toBe(true);

      const byOwner = await http()
        .put(`/v1/shop/branches/${otherB.body.id}/open-state`)
        .set(as(owner))
        .send({ isOpen: false });
      expect(byOwner.status).toBe(200);
    });

    it("shows a branch-bound person only their own branch, and an all-branches person every one", async () => {
      const mine = await createBranch(owner);
      await createBranch(owner);
      const bound = await makeMember(shopId, UserRole.SHOP_COUNTER, mine.body.id);
      const roaming = await makeMember(shopId, UserRole.SHOP_MANAGER, null);

      const boundList = await http().get("/v1/shop/branches").query({ shopId }).set(as(bound));
      expect(boundList.status).toBe(200);
      expect(boundList.body.map((b: { id: string }) => b.id)).toEqual([mine.body.id]);

      const roamingList = await http().get("/v1/shop/branches").query({ shopId }).set(as(roaming));
      expect(roamingList.body.length).toBeGreaterThanOrEqual(3);
    });

    it("lists a branch's managers and how many people work there", async () => {
      const branch = await createBranch(owner);
      const manager = await makeMember(shopId, UserRole.SHOP_MANAGER, branch.body.id);
      await makeMember(shopId, UserRole.SHOP_COUNTER, branch.body.id);

      const list = await http().get("/v1/shop/branches").query({ shopId }).set(as(owner));
      const row = list.body.find((b: { id: string }) => b.id === branch.body.id);
      expect(row.staffCount).toBe(2);
      expect(row.managers).toEqual([
        {
          membershipId: manager.membershipId,
          userId: manager.userId,
          name: "Branch API SHOP_MANAGER",
        },
      ]);
    });

    it("refuses to archive a branch that still has people, or the last branch", async () => {
      const busy = await createBranch(owner);
      await makeMember(shopId, UserRole.SHOP_COUNTER, busy.body.id);
      const withStaff = await http()
        .post(`/v1/shop/branches/${busy.body.id}/archive`)
        .set(as(owner));
      expect(withStaff.status).toBe(409);
      expect(withStaff.body.error_code).toBe("BRANCH_HAS_STAFF");

      const lonelyShop = await prisma.shop.create({
        data: { name: `Branch API Lonely ${randomUUID()}`, address: "4" },
      });
      shopIds.push(lonelyShop.id);
      const lonelyOwner = await makeMember(lonelyShop.id, UserRole.SHOP_OWNER);
      const only = await prisma.branch.findFirstOrThrow({ where: { shopId: lonelyShop.id } });
      const last = await http().post(`/v1/shop/branches/${only.id}/archive`).set(as(lonelyOwner));
      expect(last.status).toBe(409);
      expect(last.body.error_code).toBe("LAST_BRANCH");
    });

    it("does not let an archived branch be opened or edited", async () => {
      const branch = await createBranch(owner);
      await http().post(`/v1/shop/branches/${branch.body.id}/archive`).set(as(owner));
      const open = await http()
        .put(`/v1/shop/branches/${branch.body.id}/open-state`)
        .set(as(owner))
        .send({ isOpen: false });
      expect(open.status).toBe(409);
      expect(open.body.error_code).toBe("BRANCH_ARCHIVED");
      const edit = await http()
        .patch(`/v1/shop/branches/${branch.body.id}`)
        .set(as(owner))
        .send({ name: "Renamed" });
      expect(edit.status).toBe(409);
    });

    it("audits every branch change", async () => {
      const branch = await createBranch(owner, { name: "Audited" });
      await http()
        .patch(`/v1/shop/branches/${branch.body.id}`)
        .set(as(owner))
        .send({ city: "Karachi" });
      await http()
        .put(`/v1/shop/branches/${branch.body.id}/open-state`)
        .set(as(owner))
        .send({ isOpen: false });
      await http().post(`/v1/shop/branches/${branch.body.id}/archive`).set(as(owner));

      const rows = await prisma.auditLog.findMany({
        where: { resourceType: "branch", resourceId: branch.body.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => r.action)).toEqual([
        "BRANCH_CREATED",
        "BRANCH_UPDATED",
        "BRANCH_OPEN_STATE_CHANGED",
        "BRANCH_ARCHIVED",
      ]);
      expect(rows.every((r) => r.actorId === owner.userId)).toBe(true);
    });
  });
});
