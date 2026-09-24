import {
  AppException,
  PrintJobEvent,
  PrintJobStateMachine,
  periodStart,
} from "@print-automated/backend-shared";
import { OrderStatus } from "@prisma/client";
import request from "supertest";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";

describe("Printer page usage accrual (19.3, e2e)", () => {
  let fx: Fx;
  let machine: PrintJobStateMachine;

  beforeAll(async () => {
    await clearOfUtcMidnight();
    // 5-page document.
    fx = await createPhase19Fixture("usage", { multiItemEnabled: true, documentPages: 5 });
    machine = fx.app.get(PrintJobStateMachine);
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function seedJob(
    printerId: string,
    status: "QUEUED" | "CLAIMED" | "PRINTING" | "UNKNOWN",
    quantity = 1,
    attempt = 1,
  ): Promise<string> {
    const { orderId, itemIds } = await fx.makeOrder(1, quantity);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId,
        status,
        attempt,
        idempotencyToken: `${itemIds[0]}:${attempt}`,
      },
    });
    return job.id;
  }

  async function usage(printerId: string): Promise<number> {
    const row = await fx.prisma.printerPageUsage.findUnique({
      where: {
        printerId_periodStart: { printerId, periodStart: periodStart("DAILY", new Date()) },
      },
    });
    return row?.pagesUsed ?? 0;
  }

  it("N jobs completing concurrently on one printer sum exactly (pages x copies), over several rounds", async () => {
    // NOTE: Promise.all cannot PROVE the transactions overlapped; it only makes
    // overlap likely. Several rounds with fresh jobs raise the odds. The
    // simultaneous-FIRST-report test below is the one that guards double
    // accrual; this one guards the atomic increment (no lost updates).
    for (let round = 0; round < 4; round += 1) {
      const { printer } = await fx.makePrinter(`Concurrent-${round}`);
      const quantities = [1, 2, 3, 1, 2, 3, 1, 2];
      const jobIds = await Promise.all(quantities.map((q) => seedJob(printer.id, "PRINTING", q)));
      await Promise.all(
        jobIds.map((id) => machine.transition(id, PrintJobEvent.PRINTED, { id: null })),
      );
      const expected = quantities.reduce((sum, q) => sum + 5 * q, 0);
      expect(await usage(printer.id)).toBe(expected);
      expect(await fx.prisma.printerPageUsage.count({ where: { printerId: printer.id } })).toBe(1);
    }
  });

  it("three SIMULTANEOUS first PRINTED reports on one job: exactly one wins, usage counted once, the losers are state-machine conflicts", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { printer } = await fx.makePrinter(`Simultaneous-${round}`);
      const id = await seedJob(printer.id, "PRINTING", 2);
      // Thunks started together: no report is awaited before the others start.
      const attempts = [1, 2, 3].map(() =>
        machine.transition(id, PrintJobEvent.PRINTED, { id: null }),
      );
      const settled = await Promise.allSettled(attempts);
      const fulfilled = settled.filter((r) => r.status === "fulfilled");
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(AppException);
        expect((r.reason as AppException).errorCode).toBe("ILLEGAL_JOB_TRANSITION");
      }
      expect(await usage(printer.id)).toBe(10);
    }
  });

  it("a replayed PRINTED after the first has committed is refused and does not count", async () => {
    const { printer } = await fx.makePrinter("Replay");
    const id = await seedJob(printer.id, "PRINTING", 2);
    await machine.transition(id, PrintJobEvent.PRINTED, { id: null });
    const replay = await machine
      .transition(id, PrintJobEvent.PRINTED, { id: null })
      .catch((error: unknown) => error);
    expect((replay as AppException).errorCode).toBe("ILLEGAL_JOB_TRANSITION");
    expect(await usage(printer.id)).toBe(10);
  });

  it("FAILED, TIMEOUT and CANCELLED never count", async () => {
    const { printer } = await fx.makePrinter("NoCount");
    const failed = await seedJob(printer.id, "PRINTING");
    const timeout = await seedJob(printer.id, "QUEUED");
    const cancelled = await seedJob(printer.id, "QUEUED");
    await machine.transition(failed, PrintJobEvent.FAIL, { id: null });
    await machine.transition(timeout, PrintJobEvent.TIMEOUT, { id: null });
    await machine.transition(cancelled, PrintJobEvent.CANCEL, { id: null });
    expect(await usage(printer.id)).toBe(0);
  });

  it("staff resolving UNKNOWN as printed counts; resolving as failed does not", async () => {
    const { printer } = await fx.makePrinter("Unknown");
    const printed = await seedJob(printer.id, "UNKNOWN", 2);
    const failed = await seedJob(printer.id, "UNKNOWN", 2);
    await machine.transition(failed, PrintJobEvent.RESOLVE_FAILED, { id: fx.owner.id });
    expect(await usage(printer.id)).toBe(0);
    await machine.transition(printed, PrintJobEvent.RESOLVE_PRINTED, { id: fx.owner.id });
    expect(await usage(printer.id)).toBe(10);
  });

  it("a reprint (attempt 2 after a failed attempt) counts like any other job", async () => {
    const { printer } = await fx.makePrinter("Reprint");
    const first = await seedJob(printer.id, "PRINTING", 1, 1);
    await machine.transition(first, PrintJobEvent.FAIL, { id: null });
    const item = await fx.prisma.printJob.findUniqueOrThrow({
      where: { id: first },
      select: { orderId: true, orderItemId: true },
    });
    const reprint = await fx.prisma.printJob.create({
      data: {
        orderId: item.orderId,
        shopId: fx.shop.id,
        orderItemId: item.orderItemId,
        printerId: printer.id,
        status: "PRINTING",
        attempt: 2,
        idempotencyToken: `${item.orderItemId}:2`,
      },
    });
    await machine.transition(reprint.id, PrintJobEvent.PRINTED, { id: null });
    expect(await usage(printer.id)).toBe(5);
  });

  it("period rollover: last period's row does not count now; the printer response decreases correctly", async () => {
    const { printer } = await fx.makePrinter("Rollover", { pageLimit: 20, pageLimitEnabled: true });
    const today = periodStart("DAILY", new Date());
    const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
    await fx.prisma.printerPageUsage.create({
      data: { printerId: printer.id, periodStart: yesterday, pagesUsed: 999 },
    });
    const list = async () => {
      const res = await request(fx.app.getHttpServer())
        .get(`/v1/shop/printers?shopId=${fx.shop.id}`)
        .set("Authorization", `Bearer ${fx.token}`)
        .expect(200);
      return (
        res.body as Array<{
          id: string;
          pagesUsedInPeriod: number;
          remainingAllowance: number | null;
        }>
      ).find((p) => p.id === printer.id)!;
    };
    expect(await list()).toMatchObject({ pagesUsedInPeriod: 0, remainingAllowance: 20 });

    const id = await seedJob(printer.id, "PRINTING", 1);
    await machine.transition(id, PrintJobEvent.PRINTED, { id: null });
    expect(await list()).toMatchObject({ pagesUsedInPeriod: 5, remainingAllowance: 15 });
    const old = await fx.prisma.printerPageUsage.findUniqueOrThrow({
      where: { printerId_periodStart: { printerId: printer.id, periodStart: yesterday } },
    });
    expect(old.pagesUsed).toBe(999);
  });

  it("a 5-of-100-page range job accrues 5 x copies, not the whole document (19.7)", async () => {
    const big = await createPhase19Fixture("usage-range", {
      multiItemEnabled: true,
      documentPages: 100,
    });
    try {
      const m = big.app.get(PrintJobStateMachine);
      const { printer } = await big.makePrinter("Range");
      // quantity (3) deliberately differs from configuration.copies (2): the
      // item's quantity is what is printed, so 5 pages x 3 = 15 (not 10).
      const cfg = {
        pages: { mode: "range", from: 10, to: 14 },
        copies: 2,
        paperSize: "A4",
        color: "BW",
        sides: "SINGLE",
        orientation: "PORTRAIT",
      };
      const { orderId, itemIds } = await big.makeOrder(1, 3, OrderStatus.QUEUED_FOR_PRINT, cfg);
      const job = await big.prisma.printJob.create({
        data: {
          orderId,
          shopId: big.shop.id,
          orderItemId: itemIds[0]!,
          printerId: printer.id,
          status: "PRINTING",
          idempotencyToken: `${itemIds[0]}:1`,
        },
      });
      await m.transition(job.id, PrintJobEvent.PRINTED, { id: null });
      const row = await big.prisma.printerPageUsage.findFirstOrThrow({
        where: { printerId: printer.id },
      });
      expect(row.pagesUsed).toBe(15);
    } finally {
      await big.cleanup();
    }
  });

  it("a legacy job with no order item uses the order's own configuration (19.7)", async () => {
    const { printer } = await fx.makePrinter("Legacy");
    const cfg = {
      pages: { mode: "range", from: 1, to: 2 },
      copies: 4,
      paperSize: "A4",
      color: "BW",
      sides: "SINGLE",
      orientation: "PORTRAIT",
    };
    const { orderId } = await fx.makeOrder(0, 1, OrderStatus.QUEUED_FOR_PRINT, cfg);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: null,
        printerId: printer.id,
        status: "PRINTING",
        idempotencyToken: `legacy:${orderId}`,
      },
    });
    await machine.transition(job.id, PrintJobEvent.PRINTED, { id: null });
    expect(await usage(printer.id)).toBe(8);
  });

  it("period rollover with an injected clock: the same printer accrues into a new row across a boundary (19.7)", async () => {
    const { printer } = await fx.makePrinter("Clock");
    const day1 = new Date("2031-03-10T23:59:59.000Z");
    const day2 = new Date("2031-03-11T00:00:01.000Z");
    const a = await seedJob(printer.id, "PRINTING", 1);
    const b = await seedJob(printer.id, "PRINTING", 2);
    await machine.transition(a, PrintJobEvent.PRINTED, { id: null }, { now: day1 });
    await machine.transition(b, PrintJobEvent.PRINTED, { id: null }, { now: day2 });
    const rows = await fx.prisma.printerPageUsage.findMany({
      where: { printerId: printer.id },
      orderBy: { periodStart: "asc" },
    });
    expect(rows.map((r) => [r.periodStart.toISOString(), r.pagesUsed])).toEqual([
      ["2031-03-10T00:00:00.000Z", 5],
      ["2031-03-11T00:00:00.000Z", 10],
    ]);
  });
});
