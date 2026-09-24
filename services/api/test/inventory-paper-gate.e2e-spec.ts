import { PrinterStatus, type InventoryItem } from "@prisma/client";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.3 (§28): before AUTOMATIC allocation, check the required paper is in
 * stock -- but only for shops that switched inventory tracking on. */
describe("Paper availability gate (20.3, e2e)", () => {
  describe("multi-item shop", () => {
    let fx: InventoryFixture;
    const http = () => request(fx.app.getHttpServer());
    const auth = (token = fx.token) => ({ Authorization: `Bearer ${token}` });

    beforeAll(async () => {
      // 5-page document: an order of quantity q needs 5*q sheets single-sided.
      fx = await createInventoryFixture("paper-gate", { multiItemEnabled: true, documentPages: 5 });
      await fx.makePrinter("Gate printer");
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    async function setTracking(enabled: boolean, token = fx.token) {
      return http()
        .put("/v1/shop/inventory/settings")
        .set(auth(token))
        .send({ shopId: fx.shop.id, trackingEnabled: enabled });
    }
    async function stock(
      quantity: number,
      over: Partial<Pick<InventoryItem, "paperSize" | "paperType" | "active">> = {},
    ) {
      return fx.prisma.inventoryItem.create({
        data: {
          shopId: fx.shop.id,
          name: `stock-${Math.random()}`,
          paperSize: "A4",
          paperType: "STANDARD",
          quantity,
          ...over,
        },
      });
    }
    async function clearStock() {
      // only this fixture's own shop
      await fx.prisma.inventoryItem.deleteMany({ where: { shopId: fx.shop.id } });
    }
    async function acceptOrder(quantity = 1, config?: Record<string, unknown>) {
      const { orderId } = await fx.makeOrder(1, quantity, undefined, config);
      await http().post(`/v1/shop/orders/${orderId}/accept`).set(auth()).expect(200);
      return fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
    }
    const A4 = {
      pages: { mode: "all" },
      copies: 1,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };

    beforeEach(async () => {
      await clearStock();
      await setTracking(false);
    });

    it("tracking OFF (the default): zero stock does not matter -- the job allocates exactly as before", async () => {
      expect(
        (await fx.prisma.shop.findUniqueOrThrow({ where: { id: fx.shop.id } }))
          .inventoryTrackingEnabled,
      ).toBe(false);
      await stock(0);
      const job = await acceptOrder();
      expect(job.status).toBe("QUEUED");
      expect(job.blockedReason).toBeNull();
    });

    it("tracking OFF and no inventory rows at all: allocates (a shop that never adopted inventory is untouched)", async () => {
      const job = await acceptOrder();
      expect(job.status).toBe("QUEUED");
    });

    it("tracking ON with zero A4 stock: the job is WAITING with blocked reason NO_PAPER and no printer", async () => {
      await stock(0);
      await setTracking(true);
      const job = await acceptOrder();
      expect(job.status).toBe("WAITING");
      expect(job.blockedReason).toBe("NO_PAPER");
      expect(job.printerId).toBeNull();
    });

    it("needs the sheets, not just some paper: 4 in stock blocks a 5-sheet job, exactly 5 allocates", async () => {
      const item = await stock(4);
      await setTracking(true);
      expect((await acceptOrder()).blockedReason).toBe("NO_PAPER");
      await fx.prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: 5 } });
      const ok = await acceptOrder();
      expect(ok.status).toBe("QUEUED");
      // copies multiply the need: 2 copies need 10
      const two = await acceptOrder(2);
      expect(two.status).toBe("WAITING");
      expect(two.blockedReason).toBe("NO_PAPER");
    });

    it("double-sided halves the need (rounded up per copy)", async () => {
      // The fixture printers are simplex; this test is about paper, so allow duplex.
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id },
        data: { capabilities: { color: false, duplex: true, a4: true, a3: false } },
      });
      await stock(3);
      await setTracking(true);
      const job = await acceptOrder(1, { ...A4, sides: "DOUBLE" }); // 5 pages -> 3 sheets
      expect(job.status).toBe("QUEUED");
      await clearStock();
      await stock(2);
      expect((await acceptOrder(1, { ...A4, sides: "DOUBLE" })).blockedReason).toBe("NO_PAPER");
    });

    it("the paper must match: another size, another type, or an inactive item do not count", async () => {
      await stock(500, { paperSize: "A3" });
      await stock(500, { paperType: "PREMIUM" });
      await stock(500, { active: false });
      await setTracking(true);
      expect((await acceptOrder()).blockedReason).toBe("NO_PAPER");
      // an untyped A4 item serves any A4 job; stock spread over matching items is summed
      await stock(3, { paperType: null });
      await stock(2, { paperType: "STANDARD" });
      expect((await acceptOrder()).status).toBe("QUEUED");
    });

    it("a PREMIUM job needs PREMIUM (or untyped) stock, not STANDARD", async () => {
      await stock(500, { paperType: "STANDARD" });
      await setTracking(true);
      const blocked = await acceptOrder(1, { ...A4, paperType: "PREMIUM" });
      expect(blocked.blockedReason).toBe("NO_PAPER");
      await stock(500, { paperType: "PREMIUM" });
      expect((await acceptOrder(1, { ...A4, paperType: "PREMIUM" })).status).toBe("QUEUED");
    });

    it("tracking ON but no matching stock rows at all counts as zero stock (NO_PAPER)", async () => {
      await setTracking(true);
      expect((await acceptOrder()).blockedReason).toBe("NO_PAPER");
    });

    it("toggling tracking back OFF releases the gate immediately", async () => {
      await setTracking(true);
      expect((await acceptOrder()).blockedReason).toBe("NO_PAPER");
      await setTracking(false);
      expect((await acceptOrder()).status).toBe("QUEUED");
    });

    it("manual reassignment ignores the gate (a human naming a printer overrides automation)", async () => {
      const a = await fx.makePrinter("Reassign-A");
      const b = await fx.makePrinter("Reassign-B");
      await stock(0);
      await setTracking(true);
      const { orderId, itemIds } = await fx.makeOrder(1);
      const job = await fx.prisma.printJob.create({
        data: {
          orderId,
          shopId: fx.shop.id,
          orderItemId: itemIds[0]!,
          printerId: a.printer.id,
          status: "QUEUED",
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      const res = await http()
        .post(`/v1/print-jobs/${job.id}/reassign`)
        .set(auth())
        .send({ printerId: b.printer.id, reason: "manual override" });
      expect(res.status).toBe(200);
      expect(res.body.printerId).toBe(b.printer.id);
    });

    describe("restock recovery", () => {
      it("shop opted in to automatic recovery: adding stock re-allocates the NO_PAPER job", async () => {
        const item = await stock(0);
        await setTracking(true);
        await fx.prisma.shop.update({
          where: { id: fx.shop.id },
          data: { autoFailoverEnabled: true },
        });
        const job = await acceptOrder();
        expect(job.blockedReason).toBe("NO_PAPER");

        await http()
          .post(`/v1/shop/inventory/items/${item.id}/movements`)
          .set(auth())
          .send({ type: "PURCHASE", quantityDelta: 100, reason: "delivery" })
          .expect(201);

        const after = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(after.status).toBe("QUEUED");
        expect(after.blockedReason).toBeNull();
        expect(after.printerId).not.toBeNull();
        await fx.prisma.shop.update({
          where: { id: fx.shop.id },
          data: { autoFailoverEnabled: false },
        });
      });

      it("shop NOT opted in: restock never auto-allocates (PRD 122: automation is opt-in); staff act manually", async () => {
        const item = await stock(0);
        await setTracking(true);
        const job = await acceptOrder();
        expect(job.blockedReason).toBe("NO_PAPER");
        await http()
          .post(`/v1/shop/inventory/items/${item.id}/movements`)
          .set(auth())
          .send({ type: "PURCHASE", quantityDelta: 100 })
          .expect(201);
        const after = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(after.status).toBe("WAITING");
        expect(after.blockedReason).toBe("NO_PAPER");
      });
    });

    describe("settings endpoint", () => {
      it("PUT flips the flag, is audited, and GET reads it back", async () => {
        const res = await setTracking(true);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ shopId: fx.shop.id, trackingEnabled: true });
        const get = await http()
          .get("/v1/shop/inventory/settings")
          .query({ shopId: fx.shop.id })
          .set(auth(fx.operator.token));
        expect(get.status).toBe(200);
        expect(get.body.trackingEnabled).toBe(true);
        const audit = await fx.prisma.auditLog.findMany({
          where: { resourceId: fx.shop.id, action: "INVENTORY_TRACKING_CHANGED" },
        });
        expect(audit.length).toBeGreaterThan(0);
        expect(audit[audit.length - 1]!.metadata).toMatchObject({ enabled: true });
      });

      it("operators can read but not change it; counter cannot read; another shop cannot do either", async () => {
        expect((await setTracking(true, fx.operator.token)).status).toBe(403);
        expect(
          (
            await http()
              .get("/v1/shop/inventory/settings")
              .query({ shopId: fx.shop.id })
              .set(auth(fx.counter.token))
          ).status,
        ).toBe(403);
        expect((await setTracking(true, fx.ownerB.token)).status).toBe(403);
        expect(
          (
            await http()
              .get("/v1/shop/inventory/settings")
              .query({ shopId: fx.shop.id })
              .set(auth(fx.ownerB.token))
          ).status,
        ).toBe(403);
        expect((await setTracking(true, fx.manager.token)).status).toBe(200);
      });
    });

    it("an OFFLINE printer is still reported as its own reason, not NO_PAPER, when stock is fine", async () => {
      await stock(500);
      await setTracking(true);
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id },
        data: { status: PrinterStatus.OFFLINE },
      });
      const job = await acceptOrder();
      expect(job.blockedReason).toBe("PRINTER_OFFLINE");
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id },
        data: { status: PrinterStatus.ONLINE },
      });
    });
  });

  describe("legacy shop (multiItemEnabled false)", () => {
    let fx: InventoryFixture;
    beforeAll(async () => {
      fx = await createInventoryFixture("paper-gate-legacy", { multiItemEnabled: false });
      await fx.makePrinter("Legacy printer");
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("tracking ON and no stock: accept fails with the legacy 409 NO_PRINTER_AVAILABLE and says why; no job row is created", async () => {
      await fx.prisma.shop.update({
        where: { id: fx.shop.id },
        data: { inventoryTrackingEnabled: true },
      });
      const { orderId } = await fx.makeOrder(1);
      const res = await request(fx.app.getHttpServer())
        .post(`/v1/shop/orders/${orderId}/accept`)
        .set("Authorization", `Bearer ${fx.token}`);
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
      expect(res.body.message).toMatch(/paper/i);
      expect(await fx.prisma.printJob.count({ where: { orderId } })).toBe(0);
    });
  });
});
