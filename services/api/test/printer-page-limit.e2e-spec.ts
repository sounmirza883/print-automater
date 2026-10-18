import { PrinterStatus } from "@prisma/client";
import { periodStart } from "@print-automated/backend-shared";
import request from "supertest";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

async function seedUsage(fx: Fx, printerId: string, pages: number): Promise<void> {
  await fx.prisma.printerPageUsage.create({
    data: { printerId, periodStart: periodStart("DAILY", new Date()), pagesUsed: pages },
  });
}

function accept(fx: Fx, orderId: string) {
  return request(fx.app.getHttpServer())
    .post(`/v1/shop/orders/${orderId}/accept`)
    .set("Authorization", `Bearer ${fx.token}`);
}

describe("Printer page limits in allocation (19.2, e2e)", () => {
  describe("multi-item shop, two printers", () => {
    let fx: Fx;
    beforeAll(async () => {
      await clearOfUtcMidnight();
      fx = await createPhase19Fixture("pl-multi", { multiItemEnabled: true, documentPages: 5 });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("A at its limit with enforcement enabled: auto-dispatch picks B", async () => {
      const a = await fx.makePrinter("A", { pageLimit: 10, pageLimitEnabled: true });
      const b = await fx.makePrinter("B");
      await seedUsage(fx, a.printer.id, 10);
      const { orderId } = await fx.makeOrder(1);
      await accept(fx, orderId).expect(200);
      const jobs = await fx.prisma.printJob.findMany({ where: { orderId } });
      expect(jobs.map((j) => j.printerId)).toEqual([b.printer.id]);
      expect(jobs[0]?.status).toBe("QUEUED");
    });

    it("remaining allowance is compared with pages x copies", async () => {
      const c = await fx.makePrinter("C", { pageLimit: 100, pageLimitEnabled: true });
      await fx.prisma.printer.updateMany({
        where: { shopId: fx.shop.id, id: { not: c.printer.id } },
        data: { status: PrinterStatus.DISABLED },
      });
      // 5-page doc x 2 copies = 10 pages; 8 remaining is not enough.
      await seedUsage(fx, c.printer.id, 92);
      const first = await fx.makeOrder(1, 2);
      await accept(fx, first.orderId).expect(200);
      const blocked = await fx.prisma.printJob.findFirstOrThrow({
        where: { orderId: first.orderId },
      });
      expect(blocked.status).toBe("WAITING");
      expect(blocked.blockedReason).toBe("PAGE_LIMIT_REACHED");

      // exactly 10 remaining is enough
      await fx.prisma.printerPageUsage.updateMany({
        where: { printerId: c.printer.id },
        data: { pagesUsed: 90 },
      });
      const second = await fx.makeOrder(1, 2);
      await accept(fx, second.orderId).expect(200);
      const ok = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId: second.orderId } });
      expect(ok.printerId).toBe(c.printer.id);
      expect(ok.status).toBe("QUEUED");
    });
  });

  describe("only one printer", () => {
    let fx: Fx;
    beforeAll(async () => {
      await clearOfUtcMidnight();
      fx = await createPhase19Fixture("pl-only", { multiItemEnabled: true });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });

    it("enabled: blocked with PAGE_LIMIT_REACHED; disabled via PATCH: A is chosen normally", async () => {
      const a = await fx.makePrinter("A", { pageLimit: 5, pageLimitEnabled: true });
      await seedUsage(fx, a.printer.id, 5);
      const first = await fx.makeOrder(1);
      await accept(fx, first.orderId).expect(200);
      const blocked = await fx.prisma.printJob.findFirstOrThrow({
        where: { orderId: first.orderId },
      });
      expect(blocked.status).toBe("WAITING");
      expect(blocked.blockedReason).toBe("PAGE_LIMIT_REACHED");

      await request(fx.app.getHttpServer())
        .patch(`/v1/shop/printers/${a.printer.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ pageLimitEnabled: false })
        .expect(200);
      const second = await fx.makeOrder(1);
      await accept(fx, second.orderId).expect(200);
      const job = await fx.prisma.printJob.findFirstOrThrow({ where: { orderId: second.orderId } });
      expect(job.printerId).toBe(a.printer.id);
      expect(job.status).toBe("QUEUED");
    });

    it("manual reassignment to a printer at its limit succeeds", async () => {
      const source = await fx.makePrinter("Source");
      const limited = await fx.makePrinter("Limited", { pageLimit: 5, pageLimitEnabled: true });
      await seedUsage(fx, limited.printer.id, 5);
      const { orderId, itemIds } = await fx.makeOrder(1);
      const job = await fx.prisma.printJob.create({
        data: {
          orderId,
          shopId: fx.shop.id,
          branchId: await branchIdOf(fx.prisma, fx.shop.id),
          orderItemId: itemIds[0]!,
          printerId: source.printer.id,
          status: "QUEUED",
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      const res = await request(fx.app.getHttpServer())
        .post(`/v1/print-jobs/${job.id}/reassign`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ printerId: limited.printer.id, reason: "manual override" })
        .expect(200);
      expect(res.body.printerId).toBe(limited.printer.id);
    });

    it("PATCH sets the limit fields; the response exposes usage and allowance", async () => {
      const p = await fx.makePrinter("Config");
      await seedUsage(fx, p.printer.id, 3);
      const res = await request(fx.app.getHttpServer())
        .patch(`/v1/shop/printers/${p.printer.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ pageLimit: 10, pageLimitEnabled: true, pageLimitPeriod: "DAILY" })
        .expect(200);
      expect(res.body).toMatchObject({
        pageLimit: 10,
        pageLimitEnabled: true,
        pageLimitPeriod: "DAILY",
        pagesUsedInPeriod: 3,
        remainingAllowance: 7,
      });
      const off = await request(fx.app.getHttpServer())
        .patch(`/v1/shop/printers/${p.printer.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ pageLimitEnabled: false })
        .expect(200);
      expect(off.body.remainingAllowance).toBeNull();
      await request(fx.app.getHttpServer())
        .patch(`/v1/shop/printers/${p.printer.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .send({ pageLimit: 0 })
        .expect(400);
    });
  });

  describe("single-item (legacy) shop", () => {
    let fx: Fx;
    beforeAll(async () => {
      await clearOfUtcMidnight();
      fx = await createPhase19Fixture("pl-legacy", { multiItemEnabled: false });
    });
    afterAll(async () => {
      await fx?.cleanup();
    });
    it("keeps NO_PRINTER_AVAILABLE but names the page limit in the message", async () => {
      const a = await fx.makePrinter("A", { pageLimit: 5, pageLimitEnabled: true });
      await seedUsage(fx, a.printer.id, 5);
      const { orderId } = await fx.makeOrder(1);
      const res = await accept(fx, orderId).expect(409);
      expect(res.body.error_code).toBe("NO_PRINTER_AVAILABLE");
      expect(res.body.message).toContain("page limit");
    });
  });
});
