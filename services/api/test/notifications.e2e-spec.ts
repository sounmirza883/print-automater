import { randomUUID } from "node:crypto";
import {
  NotificationChannel,
  NotificationType,
  OrderStatus,
  ShopStaffStatus,
} from "@prisma/client";
import {
  PrintJobEvent,
  PrintJobStateMachine,
  syncLowStockAlerts,
} from "@print-automated/backend-shared";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 23.7 (PRD 37/111): the notification centre API and the staff alerts feeding it. */
describe("Notification centre (23.7, e2e)", () => {
  let fx: InventoryFixture;
  let printerId: string;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const list = (query: Record<string, string | number> = {}, token = fx.token) =>
    http().get("/v1/notifications").query(query).set(as(token));
  const staffRows = (userId: string, type?: string) =>
    fx.prisma.staffNotification.findMany({
      where: { userId, shopId: fx.shop.id, ...(type ? { type: type as never } : {}) },
      orderBy: { createdAt: "asc" },
    });
  const machine = () => fx.app.get(PrintJobStateMachine);

  async function queuedJob(status: "QUEUED" | "CREATED" = "QUEUED") {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId: status === "QUEUED" ? printerId : null,
        status,
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return { orderId, jobId: job.id };
  }

  beforeAll(async () => {
    fx = await createInventoryFixture("notif", { multiItemEnabled: false });
    printerId = (await fx.makePrinter("notif-printer")).printer.id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  describe("staff alerts are raised for the right people", () => {
    it("low stock: everyone with VIEW_INVENTORY in that business (not counter, not another business), once per alert, even with automaticNotifications off", async () => {
      await fx.prisma.shopSettings.update({
        where: { shopId: fx.shop.id },
        data: { automaticNotificationsEnabled: false },
      });
      await fx.prisma.shop.update({
        where: { id: fx.shop.id },
        data: { inventoryTrackingEnabled: true },
      });
      const item = await fx.prisma.inventoryItem.create({
        data: {
          shopId: fx.shop.id,
          name: "A4 80gsm",
          paperSize: "A4",
          quantity: 3,
          minQuantity: 10,
        },
      });
      await syncLowStockAlerts(fx.prisma);
      await syncLowStockAlerts(fx.prisma); // a second sweep must not notify again

      for (const who of [fx.owner, fx.manager.user, fx.operator.user]) {
        const rows = await staffRows(who.id, "LOW_STOCK");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          targetType: "INVENTORY_ITEM",
          targetId: item.id,
          readAt: null,
        });
        expect(rows[0]!.title).toMatch(/low stock/i);
        expect(rows[0]!.body).toContain("A4 80gsm");
      }
      expect(await staffRows(fx.counter.user.id)).toHaveLength(0);
      expect(
        await fx.prisma.staffNotification.count({ where: { userId: fx.ownerB.user.id } }),
      ).toBe(0);
      await fx.prisma.shopSettings.update({
        where: { shopId: fx.shop.id },
        data: { automaticNotificationsEnabled: true },
      });
    });

    it("a blocked job (incl. AUTOMATION_DISABLED) notifies ASSIGN_JOBS holders once per change of reason", async () => {
      const { jobId, orderId } = await queuedJob("CREATED");
      await machine().transition(
        jobId,
        PrintJobEvent.BLOCK,
        { id: null },
        {
          blockedReason: "AUTOMATION_DISABLED",
        },
      );
      // the sweep re-blocking for the SAME reason must not re-notify
      await machine().transition(
        jobId,
        PrintJobEvent.BLOCK,
        { id: null },
        {
          blockedReason: "AUTOMATION_DISABLED",
        },
      );
      let rows = (await staffRows(fx.operator.user.id, "JOB_BLOCKED")).filter(
        (r) => r.targetId === jobId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetType: "PRINT_JOB", orderId });
      expect(rows[0]!.metadata).toMatchObject({ blockedReason: "AUTOMATION_DISABLED" });

      await machine().transition(
        jobId,
        PrintJobEvent.BLOCK,
        { id: null },
        {
          blockedReason: "NO_PAPER",
        },
      );
      rows = (await staffRows(fx.operator.user.id, "JOB_BLOCKED")).filter(
        (r) => r.targetId === jobId,
      );
      expect(rows).toHaveLength(2);
      for (const who of [fx.owner, fx.manager.user]) {
        expect(
          (await staffRows(who.id, "JOB_BLOCKED")).filter((r) => r.targetId === jobId),
        ).toHaveLength(2);
      }
      expect(await staffRows(fx.counter.user.id, "JOB_BLOCKED")).toHaveLength(0);
    });

    it("a job held by a late-print report notifies staff; an ordinary pause does not", async () => {
      const plain = await queuedJob();
      await machine().transition(plain.jobId, PrintJobEvent.PAUSE, { id: fx.owner.id }, {});
      const held = await queuedJob();
      await machine().transition(
        held.jobId,
        PrintJobEvent.PAUSE,
        { id: null },
        {
          printerId: null,
          blockedReason: "MANUAL_APPROVAL_REQUIRED",
          metadata: { reason: "LATE_PRINTED_ON_SUPERSEDED_JOB", supersededJobId: plain.jobId },
        },
      );
      const rows = await staffRows(fx.operator.user.id, "JOB_HELD_LATE_PRINT");
      expect(rows.map((r) => r.targetId)).toEqual([held.jobId]);
      expect(rows[0]).toMatchObject({ targetType: "PRINT_JOB", orderId: held.orderId });
    });

    it("a failed print notifies staff (with the printer), and a staff-driven resolution does not", async () => {
      const { jobId, orderId } = await queuedJob();
      await machine().transition(jobId, PrintJobEvent.CLAIM, { id: null }, {});
      await machine().transition(jobId, PrintJobEvent.START, { id: null }, {});
      await machine().transition(jobId, PrintJobEvent.FAIL, { id: null }, {});
      const rows = (await staffRows(fx.manager.user.id, "JOB_FAILED")).filter(
        (r) => r.targetId === jobId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetType: "PRINT_JOB", orderId });
      expect(rows[0]!.metadata).toMatchObject({ printerId });
      expect(await staffRows(fx.counter.user.id, "JOB_FAILED")).toHaveLength(0);
    });

    it("a failure while raising an alert can never fail or roll back the job transition (no partial alert row)", async () => {
      const { jobId } = await queuedJob();
      await machine().transition(jobId, PrintJobEvent.CLAIM, { id: null }, {});
      await machine().transition(jobId, PrintJobEvent.START, { id: null }, {});
      const before = await fx.prisma.staffNotification.count({ where: { shopId: fx.shop.id } });
      const res = await machine().transition(
        jobId,
        PrintJobEvent.FAIL,
        { id: null },
        {
          staffAlertHook: async (tx) => {
            // a partial write, then a blow-up: both must be undone, the transition must stand
            await tx.staffNotification.create({
              data: {
                userId: fx.owner.id,
                shopId: fx.shop.id,
                type: "JOB_FAILED",
                title: "partial",
                body: "partial",
                targetType: "PRINT_JOB",
                targetId: jobId,
              },
            });
            throw new Error("boom");
          },
        },
      );
      expect(res.status).toBe("FAILED");
      expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(
        "FAILED",
      );
      expect(await fx.prisma.staffNotification.count({ where: { shopId: fx.shop.id } })).toBe(
        before,
      );
    });

    it("a removed staff member is not notified", async () => {
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { status: ShopStaffStatus.REMOVED },
      });
      const before = (await staffRows(fx.operator.user.id)).length;
      const { jobId } = await queuedJob("CREATED");
      await machine().transition(
        jobId,
        PrintJobEvent.BLOCK,
        { id: null },
        {
          blockedReason: "NO_COMPATIBLE_PRINTER",
        },
      );
      expect((await staffRows(fx.operator.user.id)).length).toBe(before);
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { status: ShopStaffStatus.ACTIVE },
      });
    });
  });

  describe("GET /v1/notifications", () => {
    it("lists the caller's own alerts, newest first, paged, with deep-link fields", async () => {
      const res = await list({ limit: 2 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ limit: 2, offset: 0 });
      expect(res.body.total).toBeGreaterThanOrEqual(4);
      expect(res.body.items).toHaveLength(2);
      const dates = res.body.items.map((n: { createdAt: string }) => Date.parse(n.createdAt));
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
      expect(res.body.items[0]).toMatchObject({
        category: "STAFF_ALERT",
        shopId: fx.shop.id,
        read: false,
        readAt: null,
      });
      expect(res.body.items[0].target).toEqual(
        expect.objectContaining({ type: expect.any(String), id: expect.any(String) }),
      );
      expect(typeof res.body.items[0].title).toBe("string");
      expect(typeof res.body.items[0].body).toBe("string");
    });

    it("never shows another user's or another business's notifications", async () => {
      const mine = await list({ limit: 100 });
      const ids = new Set(mine.body.items.map((n: { id: string }) => n.id));
      const theirs = await fx.prisma.staffNotification.findMany({
        where: { userId: { not: fx.owner.id }, shopId: fx.shop.id },
        select: { id: true },
      });
      expect(theirs.length).toBeGreaterThan(0);
      for (const row of theirs) expect(ids.has(row.id)).toBe(false);
      const b = await list({ limit: 100 }, fx.ownerB.token);
      expect(b.body.total).toBe(0);
    });

    it("validates paging, needs a login", async () => {
      expect((await list({ limit: 101 })).status).toBe(400);
      expect((await list({ offset: -1 })).status).toBe(400);
      expect((await list({ audience: "everyone" })).status).toBe(400);
      expect((await http().get("/v1/notifications")).status).toBe(401);
    });

    it("hides a business's alerts once the person has left it", async () => {
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { status: ShopStaffStatus.REMOVED },
      });
      expect((await list({}, fx.operator.token)).body.total).toBe(0);
      expect(
        (await http().get("/v1/notifications/unread-count").set(as(fx.operator.token))).body,
      ).toEqual({ count: 0 });
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { status: ShopStaffStatus.ACTIVE },
      });
    });
  });

  describe("unread count and read state", () => {
    it("unread-count, mark one read (idempotent), unread filter, mark all read", async () => {
      const count = () => http().get("/v1/notifications/unread-count").set(as(fx.manager.token));
      const before = (await count()).body.count as number;
      expect(before).toBeGreaterThanOrEqual(4);

      const first = (await list({ limit: 1 }, fx.manager.token)).body.items[0];
      const read = await http()
        .post(`/v1/notifications/${first.id}/read`)
        .set(as(fx.manager.token));
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ id: first.id, read: true });
      expect(read.body.readAt).toBeTruthy();
      expect(
        (await fx.prisma.staffNotification.findUniqueOrThrow({ where: { id: first.id } })).readAt,
      ).not.toBeNull();
      // idempotent: a second call keeps the ORIGINAL readAt
      const again = await http()
        .post(`/v1/notifications/${first.id}/read`)
        .set(as(fx.manager.token));
      expect(again.status).toBe(200);
      expect(again.body.readAt).toBe(read.body.readAt);
      expect((await count()).body.count).toBe(before - 1);

      const unread = await list({ unread: "true", limit: 100 }, fx.manager.token);
      expect(unread.body.total).toBe(before - 1);
      expect(unread.body.items.every((n: { read: boolean }) => !n.read)).toBe(true);
      const readOnly = await list({ unread: "false", limit: 100 }, fx.manager.token);
      expect(readOnly.body.total).toBe(1);

      const ownerBefore = await http().get("/v1/notifications/unread-count").set(as(fx.token));
      const all = await http().post("/v1/notifications/read-all").set(as(fx.manager.token));
      expect(all.status).toBe(200);
      expect(all.body).toEqual({ updated: before - 1 });
      expect((await count()).body.count).toBe(0);
      // one user's read-all never touches anyone else's
      expect(
        (await http().get("/v1/notifications/unread-count").set(as(fx.token))).body.count,
      ).toBe(ownerBefore.body.count);
    });

    it("someone else's notification is a 404 (never a leak) and stays unread", async () => {
      const ownersRow = (await list({ limit: 1 })).body.items[0];
      const res = await http()
        .post(`/v1/notifications/${ownersRow.id}/read`)
        .set(as(fx.ownerB.token));
      expect(res.status).toBe(404);
      expect(res.body.error_code).toBe("NOTIFICATION_NOT_FOUND");
      expect(
        (await http().post(`/v1/notifications/${randomUUID()}/read`).set(as(fx.token))).status,
      ).toBe(404);
      expect(
        (await fx.prisma.staffNotification.findUniqueOrThrow({ where: { id: ownersRow.id } }))
          .readAt,
      ).toBeNull();
    });

    it("unread-count and read-all can be scoped to one business's alerts", async () => {
      const scoped = await http()
        .get("/v1/notifications/unread-count")
        .query({ shopId: fx.shopB.id })
        .set(as(fx.token));
      expect(scoped.status).toBe(200);
      expect(scoped.body).toEqual({ count: 0 });
      const none = await http()
        .post("/v1/notifications/read-all")
        .query({ shopId: fx.shopB.id })
        .set(as(fx.token));
      expect(none.body).toEqual({ updated: 0 });
    });
  });

  describe("consistent filters and current permissions (23.11)", () => {
    it("shopId together with audience=customer is a contradiction: 400 on list, count and read-all", async () => {
      const q = { shopId: fx.shop.id, audience: "customer" };
      expect((await list(q)).status).toBe(400);
      expect(
        (await http().get("/v1/notifications/unread-count").query(q).set(as(fx.token))).status,
      ).toBe(400);
      expect(
        (await http().post("/v1/notifications/read-all").query(q).set(as(fx.token))).status,
      ).toBe(400);
      // shopId + audience=staff (or no audience) stay fine
      expect((await list({ shopId: fx.shop.id, audience: "staff" })).status).toBe(200);
    });

    it("alerts vanish for someone who no longer holds the recipient permission (demoted to counter)", async () => {
      const seen = async () => (await list({ limit: 100 }, fx.operator.token)).body.total;
      const before = await seen();
      expect(before).toBeGreaterThan(0);
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { role: "SHOP_COUNTER" },
      });
      expect(await seen()).toBe(0);
      expect(
        (await http().get("/v1/notifications/unread-count").set(as(fx.operator.token))).body,
      ).toEqual({ count: 0 });
      // and read-all never touches rows they can no longer see
      const unreadRows = await fx.prisma.staffNotification.count({
        where: { userId: fx.operator.user.id, readAt: null },
      });
      const all = await http().post("/v1/notifications/read-all").set(as(fx.operator.token));
      expect(all.body).toEqual({ updated: 0 });
      expect(
        await fx.prisma.staffNotification.count({
          where: { userId: fx.operator.user.id, readAt: null },
        }),
      ).toBe(unreadRows);
      // restored role: visible again
      await fx.prisma.shopStaff.updateMany({
        where: { shopId: fx.shop.id, userId: fx.operator.user.id },
        data: { role: "OPERATOR" },
      });
      expect(await seen()).toBe(before);
    });

    it("a role that keeps only ONE of the permissions sees only that kind of alert", async () => {
      // PRINTER_MANAGER holds ASSIGN_JOBS and VIEW_INVENTORY; a counter holds neither.
      const kinds = async (token: string) =>
        new Set(
          (await list({ audience: "staff", limit: 100 }, token)).body.items.map(
            (n: { type: string }) => n.type,
          ),
        );
      expect((await kinds(fx.token)).has("LOW_STOCK")).toBe(true);
      expect((await kinds(fx.counter.token)).size).toBe(0);
    });
  });

  describe("customer order notifications share the centre", () => {
    it("lists a customer's APP notices (not their EMAIL rows) with an ORDER target, and marking one read writes readAt", async () => {
      const { orderId } = await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP);
      const app = await fx.prisma.notification.create({
        data: {
          userId: fx.customer.id,
          orderId,
          type: NotificationType.ORDER_ACCEPTED,
          channel: NotificationChannel.APP,
          payload: { subject: "Order accepted", text: "Your order was accepted." },
          sentAt: new Date(),
        },
      });
      await fx.prisma.notification.create({
        data: {
          userId: fx.customer.id,
          orderId,
          type: NotificationType.ORDER_ACCEPTED,
          channel: NotificationChannel.EMAIL,
          payload: { subject: "Order accepted", text: "Your order was accepted." },
        },
      });
      const token = fx.tokens.issueAccessToken(fx.customer);
      // Earlier tests' print transitions already gave this customer real notices, so compare
      // against the database rather than assuming an empty inbox.
      const where = { userId: fx.customer.id };
      const appRows = await fx.prisma.notification.count({ where: { ...where, channel: "APP" } });
      const emailRows = await fx.prisma.notification.count({
        where: { ...where, channel: "EMAIL" },
      });
      const unreadBefore = await fx.prisma.notification.count({
        where: { ...where, channel: "APP", readAt: null },
      });
      expect(emailRows).toBeGreaterThan(0);
      const res = await list({ limit: 100 }, token);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(appRows);
      expect(res.body.items.find((n: { id: string }) => n.id === app.id)).toMatchObject({
        id: app.id,
        category: "CUSTOMER_ORDER",
        type: "ORDER_ACCEPTED",
        title: "Order accepted",
        body: "Your order was accepted.",
        shopId: null,
        read: false,
        target: { type: "ORDER", id: orderId, orderId },
      });
      expect((await http().get("/v1/notifications/unread-count").set(as(token))).body).toEqual({
        count: unreadBefore,
      });
      const read = await http().post(`/v1/notifications/${app.id}/read`).set(as(token));
      expect(read.status).toBe(200);
      expect(
        (await fx.prisma.notification.findUniqueOrThrow({ where: { id: app.id } })).readAt,
      ).not.toBeNull();
      expect((await http().get("/v1/notifications/unread-count").set(as(token))).body).toEqual({
        count: unreadBefore - 1,
      });
      // staff cannot mark the customer's row read
      expect((await http().post(`/v1/notifications/${app.id}/read`).set(as(fx.token))).status).toBe(
        404,
      );
    });

    it("audience filters the merged feed", async () => {
      const token = fx.tokens.issueAccessToken(fx.customer);
      expect((await list({ audience: "staff" }, token)).body.total).toBe(0);
      const appRows = await fx.prisma.notification.count({
        where: { userId: fx.customer.id, channel: "APP" },
      });
      expect((await list({ audience: "customer" }, token)).body.total).toBe(appRows);
      expect((await list({ audience: "customer" })).body.total).toBe(0);
    });
  });
});
