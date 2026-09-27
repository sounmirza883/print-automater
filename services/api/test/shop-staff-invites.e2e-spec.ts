import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ShopStaffStatus, ShopStatus, UserRole } from "@prisma/client";
import { PrismaService, ROLE_PERMISSIONS } from "@print-automated/backend-shared";
import request from "supertest";
import type { ApiEnv } from "@print-automated/config";
import { AppModule } from "../src/app.module.js";
import { TokenService } from "../src/auth/token.service.js";
import { API_ENV } from "../src/config/config.module.js";
import { configureApp } from "../src/bootstrap.js";
import { NotificationService } from "../src/notifications/notification.service.js";

/** 23.15: identity (`/me` with effective permissions), add-by-email with a uniform response,
 * emailed single-use invitations, and the minimal staff directory. */
describe("Shop staff identity, invitations and directory (23.15, e2e)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let tokenService: TokenService;
  const sent: Array<{ email: string; shopName: string; role: string; token: string | null }> = [];

  let shopA: { id: string; name: string };
  let shopB: { id: string };
  const users: Record<string, { id: string; email: string; role: UserRole }> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const shopIds: string[] = [];

  const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
  const freshEmail = (label: string) => `invite-e2e-${label}-${randomUUID()}@print-automated.dev`;

  async function makeUser(key: string, role: UserRole, email = freshEmail(key)) {
    const user = await prisma.user.create({
      data: { role, name: `Invite E2E ${key}`, email, passwordHash: "irrelevant" },
    });
    userIds.push(user.id);
    users[key] = { id: user.id, email: user.email, role: user.role };
    tokens[key] = tokenService.issueAccessToken(user);
    return user;
  }

  async function makeStaff(key: string, role: UserRole, shopId: string) {
    const user = await makeUser(key, role);
    const membership = await prisma.shopStaff.create({
      data: { shopId, userId: user.id, role, status: ShopStaffStatus.ACTIVE },
    });
    return { user, membership };
  }

  async function invite(
    key: string,
    email: string,
    role: string,
    shopId: string = shopA.id,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post("/v1/shop/staff")
      .set(auth(key))
      .send({ shopId, email, role });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationService)
      .useValue({
        sendStaffInvite: async (
          email: string,
          shopName: string,
          role: string,
          token: string | null,
        ) => {
          sent.push({ email, shopName, role, token });
        },
        sendPasswordRecovery: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, app.get<ApiEnv>(API_ENV));
    await app.init();
    prisma = app.get(PrismaService);
    tokenService = app.get(TokenService);

    shopA = await prisma.shop.create({
      data: { name: `Invite E2E A ${randomUUID()}`, address: "1", status: ShopStatus.OPEN },
    });
    shopB = await prisma.shop.create({
      data: { name: `Invite E2E B ${randomUUID()}`, address: "2", status: ShopStatus.OPEN },
    });
    shopIds.push(shopA.id, shopB.id);

    await makeStaff("ownerA", UserRole.SHOP_OWNER, shopA.id);
    await makeStaff("managerA", UserRole.SHOP_MANAGER, shopA.id);
    await makeStaff("counterA", UserRole.SHOP_COUNTER, shopA.id);
    await makeStaff("operatorA", UserRole.OPERATOR, shopA.id);
    await makeStaff("operator2A", UserRole.OPERATOR, shopA.id);
    await makeStaff("ownerB", UserRole.SHOP_OWNER, shopB.id);
    await makeUser("customer", UserRole.CUSTOMER);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { action: { startsWith: "SHOP_STAFF_INVITE" }, actorId: { in: userIds } },
    });
    await prisma.shopStaffInvite.deleteMany({ where: { shopId: { in: shopIds } } });
    await prisma.shopStaff.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  describe("GET /v1/shop/staff/me", () => {
    it("returns the person and, per business, the role plus the effective permission list", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set(auth("operatorA"));
      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: users.operatorA!.id,
        name: "Invite E2E operatorA",
        email: users.operatorA!.email,
      });
      expect(res.body.shops).toHaveLength(1);
      expect(res.body.shops[0]).toMatchObject({ id: shopA.id, role: "OPERATOR" });
      expect([...res.body.shops[0].permissions].sort()).toEqual(
        [...ROLE_PERMISSIONS.OPERATOR].sort(),
      );
      expect(res.body.shops[0].permissions).not.toContain("MANAGE_USERS");
    });

    it("reflects the role at THIS business, and the owner's list is a superset of the manager's", async () => {
      const owner = await request(app.getHttpServer()).get("/v1/shop/staff/me").set(auth("ownerA"));
      const manager = await request(app.getHttpServer())
        .get("/v1/shop/staff/me")
        .set(auth("managerA"));
      const ownerPerms: string[] = owner.body.shops[0].permissions;
      const managerPerms: string[] = manager.body.shops[0].permissions;
      expect(ownerPerms).toContain("MANAGE_SETTINGS");
      expect(managerPerms).not.toContain("MANAGE_SETTINGS");
      for (const permission of managerPerms) {
        expect(ownerPerms).toContain(permission);
      }
    });
  });

  describe("POST /v1/shop/staff by email", () => {
    it("answers identically and does identical work for an existing account and an unknown address: a pending invitation, never a direct add", async () => {
      const existing = await makeUser("existing", UserRole.CUSTOMER);
      const known = await invite("ownerA", existing.email, "OPERATOR");
      const unknownEmail = freshEmail("unknown");
      const unknown = await invite("ownerA", unknownEmail, "OPERATOR");
      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(known.body).toEqual({ result: "PROCESSED" });
      expect(unknown.body).toEqual(known.body);

      // 23.18: neither is a member yet (registering/holding an address is not consent).
      expect(
        await prisma.shopStaff.findUnique({
          where: { shopId_userId: { shopId: shopA.id, userId: existing.id } },
        }),
      ).toBeNull();
      // Same observable state: a pending invite each, visible in the invite list, absent from
      // the roster search.
      for (const email of [existing.email, unknownEmail]) {
        const pending = await prisma.shopStaffInvite.findUniqueOrThrow({
          where: { shopId_email: { shopId: shopA.id, email } },
        });
        expect(pending).toMatchObject({ role: "OPERATOR", acceptedAt: null });
        const mail = sent.filter((m) => m.email === email).at(-1)!;
        expect(mail.token).toEqual(expect.any(String));
        expect(JSON.stringify(pending)).not.toContain(mail.token!);
      }
      const roster = await request(app.getHttpServer())
        .get("/v1/shop/staff")
        .query({ shopId: shopA.id, q: existing.email })
        .set(auth("ownerA"));
      expect(roster.body.items).toEqual([]);
      // The same audit shape for both (no existingAccount flag).
      const rows = await prisma.auditLog.findMany({
        where: { action: "SHOP_STAFF_INVITED", actorId: users.ownerA!.id },
        orderBy: { createdAt: "desc" },
        take: 2,
      });
      for (const row of rows) {
        expect(Object.keys(row.metadata as object).sort()).toEqual([
          "addressMasked",
          "role",
          "shopId",
        ]);
      }
    });

    it("an account registered with the invited address cannot join without the emailed token (pre-registration hijack)", async () => {
      const victim = freshEmail("victim");
      expect((await invite("ownerA", victim, "SHOP_MANAGER")).status).toBe(202);
      const attacker = await makeUser("attacker", UserRole.CUSTOMER, victim);
      const res = await request(app.getHttpServer())
        .post("/v1/shop/staff-invites/accept")
        .set(auth("attacker"))
        .send({ token: "x".repeat(43) });
      expect(res.status).toBe(404);
      expect(
        await prisma.shopStaff.findUnique({
          where: { shopId_userId: { shopId: shopA.id, userId: attacker.id } },
        }),
      ).toBeNull();
    });

    it("is case-insensitive on the address and still rejects a body with both or neither of userId/email", async () => {
      const existing = await makeUser("mixedcase", UserRole.CUSTOMER);
      const res = await invite("ownerA", existing.email.toUpperCase(), "SHOP_COUNTER");
      expect(res.status).toBe(202);
      expect(
        await prisma.shopStaffInvite.findUnique({
          where: { shopId_email: { shopId: shopA.id, email: existing.email } },
        }),
      ).toMatchObject({ role: "SHOP_COUNTER" });

      const both = await request(app.getHttpServer())
        .post("/v1/shop/staff")
        .set(auth("ownerA"))
        .send({ shopId: shopA.id, userId: existing.id, email: freshEmail("x"), role: "OPERATOR" });
      expect(both.status).toBe(400);
      const neither = await request(app.getHttpServer())
        .post("/v1/shop/staff")
        .set(auth("ownerA"))
        .send({ shopId: shopA.id, role: "OPERATOR" });
      expect(neither.status).toBe(400);
    });

    it("the by-id form still returns the membership (201) exactly as before", async () => {
      const target = await makeUser("byid", UserRole.CUSTOMER);
      const res = await request(app.getHttpServer())
        .post("/v1/shop/staff")
        .set(auth("ownerA"))
        .send({ shopId: shopA.id, userId: target.id, role: "OPERATOR" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ userId: target.id, role: "OPERATOR", status: "ACTIVE" });
    });

    it("enforces authority before touching the address: counter 403, manager cannot invite an owner, business B 403", async () => {
      const email = freshEmail("authority");
      expect((await invite("counterA", email, "OPERATOR")).status).toBe(403);
      expect((await invite("managerA", email, "SHOP_OWNER")).status).toBe(403);
      expect((await invite("ownerB", email, "OPERATOR", shopA.id)).status).toBe(403);
      expect((await invite("customer", email, "OPERATOR")).status).toBe(403);
      expect(
        await prisma.shopStaffInvite.findUnique({
          where: { shopId_email: { shopId: shopA.id, email } },
        }),
      ).toBeNull();
      // A manager may invite below their own rank.
      expect((await invite("managerA", email, "OPERATOR")).status).toBe(202);
    });

    it("an owner's address answers the same 202 as any other; authority is enforced at accept, so the owner is untouched", async () => {
      const res = await invite("managerA", users.ownerA!.email, "SHOP_COUNTER");
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ result: "PROCESSED" });
      // Addresses are stored and mailed lower-cased; this fixture's address has capitals.
      const ownerAddress = users.ownerA!.email.toLowerCase();
      const token = sent.filter((m) => m.email === ownerAddress).at(-1)!.token!;
      const accept = await request(app.getHttpServer())
        .post("/v1/shop/staff-invites/accept")
        .set(auth("ownerA"))
        .send({ token });
      expect(accept.status).toBe(404);
      const owner = await prisma.shopStaff.findFirstOrThrow({
        where: { shopId: shopA.id, userId: users.ownerA!.id },
      });
      expect(owner.role).toBe("SHOP_OWNER");
    });

    it("a lower-ranked inviter cannot overwrite a higher-role pending invitation; an equal-rank one can", async () => {
      const email = freshEmail("overwrite");
      expect((await invite("ownerA", email, "SHOP_OWNER")).status).toBe(202);
      const before = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: shopA.id, email } },
      });
      const denied = await invite("managerA", email, "OPERATOR");
      expect(denied.status).toBe(403);
      const same = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: shopA.id, email } },
      });
      expect(same).toMatchObject({
        role: "SHOP_OWNER",
        invitedBy: before.invitedBy,
        tokenHash: before.tokenHash,
      });
      expect((await invite("ownerA", email, "OPERATOR")).status).toBe(202);
      expect(
        (
          await prisma.shopStaffInvite.findUniqueOrThrow({
            where: { shopId_email: { shopId: shopA.id, email } },
          })
        ).role,
      ).toBe("OPERATOR");
    });

    it("is audited without the raw address", async () => {
      const email = freshEmail("audited");
      expect((await invite("ownerA", email, "OPERATOR")).status).toBe(202);
      const rows = await prisma.auditLog.findMany({
        where: { action: "SHOP_STAFF_INVITED", actorId: users.ownerA!.id },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({ shopId: shopA.id, role: "OPERATOR" });
      expect(JSON.stringify(rows[0]!.metadata)).not.toContain(email);
    });

    it("is rate limited per (business, address) with plus-tags and dots normalised, without blocking other businesses", async () => {
      const local = `mailbomb${randomUUID().slice(0, 8)}`;
      const domain = "gmail.com";
      const variants = [
        `${local}@${domain}`,
        `${local}+a@${domain}`,
        `${local.slice(0, 4)}.${local.slice(4)}@${domain.toUpperCase()}`,
        `${local}+b@googlemail.com`,
      ];
      const statuses: number[] = [];
      for (const variant of variants) {
        statuses.push((await invite("ownerA", variant, "OPERATOR")).status);
      }
      expect(statuses).toEqual([202, 202, 202, 429]);
      // Another business is not blocked by business A's exhausted per-business budget.
      expect((await invite("ownerB", `${local}@${domain}`, "OPERATOR", shopB.id)).status).toBe(202);

      const limited = await makeStaff("busyOwner", UserRole.SHOP_OWNER, shopA.id);
      expect(limited.user.id).toBeDefined();
      let last = 0;
      let lastBody: { error_code?: string } = {};
      for (let i = 0; i < 21; i += 1) {
        const res = await invite("busyOwner", freshEmail(`bulk-${i}`), "OPERATOR");
        last = res.status;
        lastBody = res.body;
      }
      expect(last).toBe(429);
      expect(lastBody.error_code).toBe("RATE_LIMITED");
    });
  });

  describe("accepting an invitation", () => {
    async function createInvite(role = "OPERATOR", inviter = "ownerA") {
      const email = freshEmail("acceptee");
      const res = await invite(inviter, email, role);
      expect(res.status).toBe(202);
      const token = sent.filter((m) => m.email === email).at(-1)!.token!;
      return { email, token };
    }
    const accept = (key: string, token: string) =>
      request(app.getHttpServer())
        .post("/v1/shop/staff-invites/accept")
        .set(auth(key))
        .send({ token });

    it("needs the token AND the matching account: registering the address alone grants nothing", async () => {
      const { email, token } = await createInvite();
      await makeUser("acceptee", UserRole.CUSTOMER, email);
      // Registered with the invited address but no token: still no access.
      const me = await request(app.getHttpServer()).get("/v1/shop/staff/me").set(auth("acceptee"));
      expect(me.status).toBe(403);
      // A different account with the right token is refused (uniform 404).
      const wrongAccount = await accept("customer", token);
      expect(wrongAccount.status).toBe(404);
      // The right account, wrong token.
      expect((await accept("acceptee", "x".repeat(43))).status).toBe(404);
      // The right account and token joins with the invited role.
      const ok = await accept("acceptee", token);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ shopId: shopA.id, role: "OPERATOR" });
      const membership = await prisma.shopStaff.findUnique({
        where: { shopId_userId: { shopId: shopA.id, userId: users.acceptee!.id } },
      });
      expect(membership).toMatchObject({ role: "OPERATOR", status: "ACTIVE" });
      // Single use.
      expect((await accept("acceptee", token)).status).toBe(404);
    });

    it("refuses an expired, revoked, or orphaned invitation, and one whose inviter lost the authority", async () => {
      const expired = await createInvite();
      await prisma.shopStaffInvite.update({
        where: { shopId_email: { shopId: shopA.id, email: expired.email } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await makeUser("expiredAcceptee", UserRole.CUSTOMER, expired.email);
      expect((await accept("expiredAcceptee", expired.token)).status).toBe(404);

      const revoked = await createInvite();
      await prisma.shopStaffInvite.update({
        where: { shopId_email: { shopId: shopA.id, email: revoked.email } },
        data: { revokedAt: new Date() },
      });
      await makeUser("revokedAcceptee", UserRole.CUSTOMER, revoked.email);
      expect((await accept("revokedAcceptee", revoked.token)).status).toBe(404);

      // The inviter (a manager) is demoted before the invitation is used.
      const manager2 = await makeStaff("manager2A", UserRole.SHOP_MANAGER, shopA.id);
      const demoted = await createInvite("SHOP_MANAGER", "ownerA");
      await prisma.shopStaffInvite.update({
        where: { shopId_email: { shopId: shopA.id, email: demoted.email } },
        data: { invitedBy: manager2.user.id },
      });
      await prisma.shopStaff.update({
        where: { id: manager2.membership.id },
        data: { role: UserRole.SHOP_COUNTER },
      });
      await makeUser("demotedAcceptee", UserRole.CUSTOMER, demoted.email);
      const res = await accept("demotedAcceptee", demoted.token);
      expect(res.status).toBe(404);
      // ...and the claim was put back rather than burned.
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: shopA.id, email: demoted.email } },
      });
      expect(row.acceptedAt).toBeNull();
    });

    it("anonymous callers get 401", async () => {
      const res = await request(app.getHttpServer())
        .post("/v1/shop/staff-invites/accept")
        .send({ token: "x".repeat(43) });
      expect(res.status).toBe(401);
    });
  });

  describe("pending invitations", () => {
    it("lists pending invitations (MANAGE_USERS) and cancels one; a manager cannot cancel an owner-level invitation", async () => {
      const email = freshEmail("pending");
      expect((await invite("ownerA", email, "SHOP_OWNER")).status).toBe(202);
      const list = await request(app.getHttpServer())
        .get("/v1/shop/staff/invites")
        .query({ shopId: shopA.id })
        .set(auth("managerA"));
      expect(list.status).toBe(200);
      const row = list.body.items.find((i: { email: string }) => i.email === email);
      expect(row).toMatchObject({ role: "SHOP_OWNER" });
      expect(JSON.stringify(list.body)).not.toContain("tokenHash");

      const managerCancel = await request(app.getHttpServer())
        .delete(`/v1/shop/staff/invites/${row.id}`)
        .set(auth("managerA"));
      expect(managerCancel.status).toBe(403);
      const ownerCancel = await request(app.getHttpServer())
        .delete(`/v1/shop/staff/invites/${row.id}`)
        .set(auth("ownerA"));
      expect(ownerCancel.status).toBe(204);
      const after = await request(app.getHttpServer())
        .get("/v1/shop/staff/invites")
        .query({ shopId: shopA.id })
        .set(auth("ownerA"));
      expect(after.body.items.map((i: { email: string }) => i.email)).not.toContain(email);
    });

    it("cancelling an invitation that was already accepted is refused (409) and writes no audit row", async () => {
      const email = freshEmail("claimed");
      expect((await invite("ownerA", email, "OPERATOR")).status).toBe(202);
      const token = sent.filter((m) => m.email === email).at(-1)!.token!;
      await makeUser("claimedUser", UserRole.CUSTOMER, email);
      const ok = await request(app.getHttpServer())
        .post("/v1/shop/staff-invites/accept")
        .set(auth("claimedUser"))
        .send({ token });
      expect(ok.status).toBe(200);
      const row = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: shopA.id, email } },
      });
      const cancel = await request(app.getHttpServer())
        .delete(`/v1/shop/staff/invites/${row.id}`)
        .set(auth("ownerA"));
      expect(cancel.status).toBe(409);
      expect(
        await prisma.auditLog.count({
          where: { action: "SHOP_STAFF_INVITE_REVOKED", resourceId: row.id },
        }),
      ).toBe(0);
    });

    it("is tenant isolated and permission gated", async () => {
      const email = freshEmail("tenant");
      expect((await invite("ownerA", email, "OPERATOR")).status).toBe(202);
      const invite_ = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { shopId_email: { shopId: shopA.id, email } },
      });
      const crossList = await request(app.getHttpServer())
        .get("/v1/shop/staff/invites")
        .query({ shopId: shopA.id })
        .set(auth("ownerB"));
      expect(crossList.status).toBe(403);
      const crossRevoke = await request(app.getHttpServer())
        .delete(`/v1/shop/staff/invites/${invite_.id}`)
        .set(auth("ownerB"));
      expect(crossRevoke.status).toBe(403);
      const counterList = await request(app.getHttpServer())
        .get("/v1/shop/staff/invites")
        .query({ shopId: shopA.id })
        .set(auth("counterA"));
      expect(counterList.status).toBe(403);
      const stillThere = await prisma.shopStaffInvite.findUniqueOrThrow({
        where: { id: invite_.id },
      });
      expect(stillThere.revokedAt).toBeNull();
    });
  });

  describe("GET /v1/shop/staff/directory", () => {
    it("is readable at OPERATOR level and returns only id and display name", async () => {
      const res = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id, role: "OPERATOR" })
        .set(auth("operatorA"));
      expect(res.status).toBe(200);
      const ids = res.body.items.map((i: { userId: string }) => i.userId);
      expect(ids).toContain(users.operatorA!.id);
      expect(ids).toContain(users.operator2A!.id);
      expect(ids).not.toContain(users.ownerA!.id);
      for (const item of res.body.items) {
        expect(Object.keys(item).sort()).toEqual(["name", "userId"]);
      }
      expect(res.body).toMatchObject({ limit: 50, offset: 0 });
      expect(JSON.stringify(res.body)).not.toContain("@");
    });

    it("hides removed members, searches by name, pages, and every staff role can read it", async () => {
      const gone = await makeStaff("goneOperator", UserRole.OPERATOR, shopA.id);
      await prisma.shopStaff.update({
        where: { id: gone.membership.id },
        data: { status: ShopStaffStatus.REMOVED },
      });
      const all = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id, limit: 100 })
        .set(auth("counterA"));
      expect(all.status).toBe(200);
      expect(all.body.items.map((i: { userId: string }) => i.userId)).not.toContain(gone.user.id);

      const search = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id, q: "operator2A" })
        .set(auth("managerA"));
      expect(search.body.items.map((i: { userId: string }) => i.userId)).toEqual([
        users.operator2A!.id,
      ]);

      const page = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id, limit: 1, offset: 1 })
        .set(auth("ownerA"));
      expect(page.body.items).toHaveLength(1);
      expect(page.body.total).toBeGreaterThan(1);
    });

    it("the role filter cannot be used to enumerate owners/managers without MANAGE_USERS", async () => {
      for (const role of ["SHOP_OWNER", "SHOP_MANAGER"]) {
        const counter = await request(app.getHttpServer())
          .get("/v1/shop/staff/directory")
          .query({ shopId: shopA.id, role })
          .set(auth("counterA"));
        expect(counter.status).toBe(403);
        const operator = await request(app.getHttpServer())
          .get("/v1/shop/staff/directory")
          .query({ shopId: shopA.id, role })
          .set(auth("operatorA"));
        expect(operator.status).toBe(403);
        const manager = await request(app.getHttpServer())
          .get("/v1/shop/staff/directory")
          .query({ shopId: shopA.id, role })
          .set(auth("managerA"));
        expect(manager.status).toBe(200);
      }
      const operators = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id, role: "OPERATOR" })
        .set(auth("counterA"));
      expect(operators.status).toBe(200);
    });

    it("business B and customers cannot read business A's directory; anonymous 401", async () => {
      const cross = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id })
        .set(auth("ownerB"));
      expect(cross.status).toBe(403);
      const customer = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id })
        .set(auth("customer"));
      expect(customer.status).toBe(403);
      const anon = await request(app.getHttpServer())
        .get("/v1/shop/staff/directory")
        .query({ shopId: shopA.id });
      expect(anon.status).toBe(401);
    });
  });
});
