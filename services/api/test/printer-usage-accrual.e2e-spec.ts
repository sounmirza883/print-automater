import { PrintJobEvent, PrintJobStateMachine, periodStart } from "@print-automated/backend-shared";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

describe("Printer page usage accrual (19.3, e2e)", () => {
  let fx: Fx;
  let machine: PrintJobStateMachine;

  beforeAll(async () => {
    // 5-page document.
    fx = await createPhase19Fixture("usage", { multiItemEnabled: true, documentPages: 5 });
    machine = fx.app.get(PrintJobStateMachine);
  });
  afterAll(async () => {
    await fx.cleanup();
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

  it("N jobs completing concurrently on one printer sum exactly (pages x copies)", async () => {
    const { printer } = await fx.makePrinter("Concurrent");
    const quantities = [1, 2, 3, 1, 2, 3, 1, 2];
    const jobIds = await Promise.all(quantities.map((q) => seedJob(printer.id, "PRINTING", q)));
    await Promise.all(
      jobIds.map((id) => machine.transition(id, PrintJobEvent.PRINTED, { id: null })),
    );
    const expected = quantities.reduce((sum, q) => sum + 5 * q, 0);
    expect(await usage(printer.id)).toBe(expected);
    expect(await fx.prisma.printerPageUsage.count({ where: { printerId: printer.id } })).toBe(1);
  });

  it("a replayed PRINTED report does not double-count", async () => {
    const { printer } = await fx.makePrinter("Replay");
    const id = await seedJob(printer.id, "PRINTING", 2);
    await machine.transition(id, PrintJobEvent.PRINTED, { id: null });
    // Two more replays, concurrently: both refused, neither counts.
    const replays = await Promise.allSettled([
      machine.transition(id, PrintJobEvent.PRINTED, { id: null }),
      machine.transition(id, PrintJobEvent.PRINTED, { id: null }),
    ]);
    expect(replays.every((r) => r.status === "rejected")).toBe(true);
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
});
