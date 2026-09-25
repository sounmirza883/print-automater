import { PrinterStatus } from "@prisma/client";
import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 22.3 (PRD 77): ordered printer-automation rules as data. */
describe("Printer automation rules (22.3, e2e)", () => {
  let fx: InventoryFixture;
  let printerA: string;
  let printerB: string;
  let printerC: string;
  const http = () => request(fx.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const list = (token = fx.token, shopId = fx.shop.id) =>
    http().get("/v1/shop/printer-rules").query({ shopId }).set(auth(token));
  const create = (body: Record<string, unknown>, token = fx.token) =>
    http()
      .post("/v1/shop/printer-rules")
      .set(auth(token))
      .send({
        shopId: fx.shop.id,
        name: "rule",
        action: "PREFER",
        printerIds: [printerB],
        ...body,
      });
  const patch = (id: string, body: Record<string, unknown>, token = fx.token) =>
    http().patch(`/v1/shop/printer-rules/${id}`).set(auth(token)).send(body);
  const remove = (id: string, token = fx.token) =>
    http().delete(`/v1/shop/printer-rules/${id}`).set(auth(token));
  const reorder = (ruleIds: string[], token = fx.token) =>
    http()
      .put("/v1/shop/printer-rules/order")
      .set(auth(token))
      .send({ shopId: fx.shop.id, ruleIds });
  const clearRules = () =>
    fx.prisma.printerAutomationRule.deleteMany({ where: { shopId: fx.shop.id } });
  async function acceptedPrinter(): Promise<string | null> {
    const { orderId } = await fx.makeOrder(1);
    await http().post(`/v1/shop/orders/${orderId}/accept`).set(auth(fx.token)).expect(200);
    return (await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } })).printerId;
  }

  beforeAll(async () => {
    fx = await createInventoryFixture("printer-rules", { multiItemEnabled: true });
    // registered in this order: A is oldest, so with no rules A always wins the tie-break
    printerA = (await fx.makePrinter("A")).printer.id;
    printerB = (await fx.makePrinter("B")).printer.id;
    printerC = (await fx.makePrinter("C")).printer.id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });
  beforeEach(async () => {
    await clearRules();
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: PrinterStatus.ONLINE },
    });
    await fx.prisma.printJob.deleteMany({ where: { shopId: fx.shop.id } });
  });

  describe("CRUD, permissions and tenant isolation", () => {
    it("starts empty; create appends with contiguous positions; list is ordered", async () => {
      expect((await list().expect(200)).body).toEqual([]);
      const a = (await create({ name: "first" }).expect(201)).body;
      const b = (
        await create({ name: "second", action: "AVOID", printerIds: [printerA] }).expect(201)
      ).body;
      expect(a).toMatchObject({
        position: 0,
        name: "first",
        enabled: true,
        action: "PREFER",
        version: 0,
        conditions: {},
      });
      expect(b).toMatchObject({ position: 1, action: "AVOID" });
      expect((await list().expect(200)).body.map((r: { name: string }) => r.name)).toEqual([
        "first",
        "second",
      ]);
    });

    it("VIEW_SETTINGS may list (manager), MANAGE_AUTOMATION may write (owner, manager); operator and counter neither", async () => {
      await list(fx.manager.token).expect(200);
      await create({ name: "by manager" }, fx.manager.token).expect(201);
      await list(fx.operator.token).expect(403);
      await list(fx.counter.token).expect(403);
      await create({}, fx.operator.token).expect(403);
      await create({}, fx.counter.token).expect(403);
    });

    it("tenant isolation: another shop's owner cannot list, create, patch, delete or reorder", async () => {
      const rule = (await create({}).expect(201)).body;
      await list(fx.ownerB.token).expect(403);
      await create({}, fx.ownerB.token).expect(403);
      await patch(rule.id, { enabled: false }, fx.ownerB.token).expect(403);
      await remove(rule.id, fx.ownerB.token).expect(403);
      await reorder([rule.id], fx.ownerB.token).expect(403);
      expect(
        await fx.prisma.printerAutomationRule.count({ where: { id: rule.id, enabled: true } }),
      ).toBe(1);
    });

    it("a rule may only name printers of THIS shop", async () => {
      const foreign = await fx.prisma.printer.create({
        data: { shopId: fx.shopB.id, name: "foreign", status: PrinterStatus.ONLINE },
      });
      const res = await create({ printerIds: [foreign.id] }).expect(400);
      expect(res.body.error_code).toBe("RULE_PRINTER_INVALID");
      await create({ printerIds: ["0d3e1c54-8b64-4a0e-a3c6-6a8a1f6a3a01"] }).expect(400);
      await fx.prisma.printer.delete({ where: { id: foreign.id } });
    });

    it("validation: bad action, empty printers, unknown condition and inverted range are 400s", async () => {
      await create({ action: "FORCE" }).expect(400);
      await create({ printerIds: [] }).expect(400);
      await create({ conditions: { nope: 1 } }).expect(400);
      await create({ conditions: { minPages: 9, maxPages: 2 } }).expect(400);
      await patch((await create({}).expect(201)).body.id, {}).expect(400);
    });

    it("patch changes fields, bumps the version and audits before/after; a stale version is 409", async () => {
      const rule = (await create({ name: "orig" }).expect(201)).body;
      const res = await patch(rule.id, {
        name: "renamed",
        enabled: false,
        expectedVersion: 0,
      }).expect(200);
      expect(res.body).toMatchObject({ name: "renamed", enabled: false, version: 1, position: 0 });
      const audit = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "PRINTER_RULE_UPDATED", resourceId: rule.id },
      });
      expect(audit.actorId).toBe(fx.owner.id);
      expect(audit.metadata).toMatchObject({
        changedKeys: expect.arrayContaining(["name", "enabled"]),
        before: { name: "orig", enabled: true },
        after: { name: "renamed", enabled: false },
        fromVersion: 0,
        toVersion: 1,
      });
      const stale = await patch(rule.id, { name: "again", expectedVersion: 0 }).expect(409);
      expect(stale.body.error_code).toBe("RULE_VERSION_CONFLICT");
      // a no-op patch writes nothing
      const same = await patch(rule.id, { name: "renamed" }).expect(200);
      expect(same.body.version).toBe(1);
    });

    it("create and delete are audited; delete closes the gap in positions", async () => {
      const a = (await create({ name: "a" }).expect(201)).body;
      const b = (await create({ name: "b" }).expect(201)).body;
      const c = (await create({ name: "c" }).expect(201)).body;
      expect(
        await fx.prisma.auditLog.count({
          where: { action: "PRINTER_RULE_CREATED", resourceId: a.id },
        }),
      ).toBe(1);
      await remove(b.id).expect(200);
      const audit = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "PRINTER_RULE_DELETED", resourceId: b.id },
      });
      expect(audit.metadata).toMatchObject({ before: { name: "b", position: 1 } });
      const rows = (await list().expect(200)).body as Array<{ id: string; position: number }>;
      expect(rows.map((r) => [r.id, r.position])).toEqual([
        [a.id, 0],
        [c.id, 1],
      ]);
      await remove(b.id).expect(403); // gone: the shop-scope guard answers 403, never a leak
    });

    it("reorder needs exactly the existing ids, applies the new order and audits it", async () => {
      const a = (await create({ name: "a" }).expect(201)).body;
      const b = (await create({ name: "b" }).expect(201)).body;
      const c = (await create({ name: "c" }).expect(201)).body;
      const bad = await reorder([a.id, b.id]).expect(409);
      expect(bad.body.error_code).toBe("RULE_ORDER_MISMATCH");
      await reorder([c.id, a.id, b.id]).expect(200);
      expect(((await list().expect(200)).body as Array<{ id: string }>).map((r) => r.id)).toEqual([
        c.id,
        a.id,
        b.id,
      ]);
      const audit = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "PRINTER_RULES_REORDERED", resourceId: fx.shop.id },
        orderBy: { createdAt: "desc" },
      });
      expect(audit.metadata).toMatchObject({
        before: [a.id, b.id, c.id],
        after: [c.id, a.id, b.id],
      });
    });

    it("concurrent creates (Promise.all) get distinct, contiguous positions", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => create({ name: `race-${i}` })),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
      const positions = ((await list().expect(200)).body as Array<{ position: number }>).map(
        (r) => r.position,
      );
      expect(positions).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("a shop is capped at 50 rules", async () => {
      await fx.prisma.printerAutomationRule.createMany({
        data: Array.from({ length: 50 }, (_, i) => ({
          shopId: fx.shop.id,
          position: i,
          name: `bulk-${i}`,
          action: "PREFER" as const,
          printerIds: [printerA],
        })),
      });
      const res = await create({}).expect(409);
      expect(res.body.error_code).toBe("RULE_LIMIT_REACHED");
    });
  });

  describe("effect on allocation (after the hard filters, never before them)", () => {
    it("empty rule set: today's tie-break (oldest printer)", async () => {
      expect(await acceptedPrinter()).toBe(printerA);
    });

    it("PREFER routes new jobs to the preferred printer even though another is older / less loaded", async () => {
      await create({ printerIds: [printerB] }).expect(201);
      expect(await acceptedPrinter()).toBe(printerB);
    });

    it("a disabled rule and a rule whose conditions do not match are ignored", async () => {
      const off = (await create({ printerIds: [printerB] }).expect(201)).body;
      await patch(off.id, { enabled: false }).expect(200);
      await create({ printerIds: [printerC], conditions: { paperSize: "A3" } }).expect(201);
      expect(await acceptedPrinter()).toBe(printerA);
    });

    it("order matters: the earlier rule wins a conflict, and reordering changes the outcome", async () => {
      const first = (await create({ name: "first", printerIds: [printerC] }).expect(201)).body;
      const second = (await create({ name: "second", printerIds: [printerB] }).expect(201)).body;
      // PREFER C narrows to {C}; the later PREFER B finds no eligible member and is skipped
      expect(await acceptedPrinter()).toBe(printerC);
      await fx.prisma.printJob.deleteMany({ where: { shopId: fx.shop.id } });
      await reorder([second.id, first.id]).expect(200);
      expect(await acceptedPrinter()).toBe(printerB);
      await fx.prisma.printJob.deleteMany({ where: { shopId: fx.shop.id } });
      // AVOID after PREFER refines the preferred pool
      await patch(first.id, { action: "AVOID", printerIds: [printerB] }).expect(200);
      await patch(second.id, { printerIds: [printerB, printerC] }).expect(200);
      // order is [second, first]: PREFER {B,C} -> {B,C}; AVOID {B} -> {C}
      expect(await acceptedPrinter()).toBe(printerC);
    });

    it("a rule cannot override a hard filter: an OFFLINE preferred printer is never chosen", async () => {
      await create({ printerIds: [printerB] }).expect(201);
      await fx.prisma.printer.update({
        where: { id: printerB },
        data: { status: PrinterStatus.OFFLINE },
      });
      expect(await acceptedPrinter()).toBe(printerA);
    });

    it("a rule cannot override an incompatible printer either (page limit and paper are pinned in the pure allocatePrinter spec)", async () => {
      await create({ printerIds: [printerB] }).expect(201);
      await fx.prisma.printer.update({
        where: { id: printerB },
        data: { capabilities: { color: false, duplex: false, a4: false, a3: false } },
      });
      expect(await acceptedPrinter()).toBe(printerA);
      await fx.prisma.printer.update({
        where: { id: printerB },
        data: { capabilities: { color: false, duplex: false, a4: true, a3: false } },
      });
    });

    it("manual assignment ignores rules (staff name the printer)", async () => {
      await create({ action: "AVOID", printerIds: [printerC] }).expect(201);
      const { orderId } = await fx.makeOrder(1);
      await http().post(`/v1/shop/orders/${orderId}/accept`).set(auth(fx.token)).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId } });
      const res = await http()
        .post(`/v1/print-jobs/${job.id}/reassign`)
        .set(auth(fx.token))
        .send({ printerId: printerC, reason: "manual beats rules" })
        .expect(200);
      expect(res.body.printerId).toBe(printerC);
    });
  });
});
