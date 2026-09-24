import { AppException, PrintJobEvent, PrintJobStateMachine } from "@print-automated/backend-shared";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.4: paper is consumed inside the job machine's own PRINTED transaction. */
describe("Inventory consumption on job completion (20.4, e2e)", () => {
  let fx: InventoryFixture;
  let machine: PrintJobStateMachine;
  let printerId: string;

  beforeAll(async () => {
    // 5-page document.
    fx = await createInventoryFixture("inv-consume", { multiItemEnabled: true, documentPages: 5 });
    machine = fx.app.get(PrintJobStateMachine);
    printerId = (await fx.makePrinter("Consume printer")).printer.id;
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(async () => {
    await fx.prisma.inventoryItem.deleteMany({ where: { shopId: fx.shop.id } });
    await setTracking(true);
  });

  const setTracking = (enabled: boolean) =>
    fx.prisma.shop.update({
      where: { id: fx.shop.id },
      data: { inventoryTrackingEnabled: enabled },
    });

  const config = (over: Record<string, unknown> = {}) => ({
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
    ...over,
  });

  async function stock(
    quantity: number,
    over: {
      paperSize?: string | null;
      paperType?: string | null;
      active?: boolean;
      name?: string;
    } = {},
  ) {
    return fx.prisma.inventoryItem.create({
      data: {
        shopId: fx.shop.id,
        name: over.name ?? `stock-${Math.random()}`,
        paperSize: "paperSize" in over ? over.paperSize : "A4",
        paperType: "paperType" in over ? over.paperType : "STANDARD",
        active: over.active ?? true,
        quantity,
      },
    });
  }
  const qty = async (id: string) =>
    (await fx.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;

  async function seedJob(
    status: "PRINTING" | "UNKNOWN" | "QUEUED" = "PRINTING",
    quantity = 1,
    cfg: Record<string, unknown> = config(),
  ): Promise<string> {
    const { orderId, itemIds } = await fx.makeOrder(1, quantity, undefined, cfg);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        orderItemId: itemIds[0]!,
        printerId,
        status,
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return job.id;
  }
  const printed = (jobId: string) => machine.transition(jobId, PrintJobEvent.PRINTED, { id: null });
  const movementsFor = (jobId: string) =>
    fx.prisma.inventoryMovement.findMany({ where: { printJobId: jobId } });

  it("consumes pages x copies sheets, recording one CONSUMPTION movement tied to the job, atomically with PRINTED", async () => {
    const item = await stock(100);
    const job = await seedJob("PRINTING", 2); // 5 pages x 2 copies
    await printed(job);
    expect(await qty(item.id)).toBe(90);
    const rows = await movementsFor(job);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "CONSUMPTION",
      quantityDelta: -10,
      quantityAfter: 90,
      inventoryItemId: item.id,
      idempotencyKey: `consumption:${job}:${item.id}`,
    });
    expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job } })).status).toBe(
      "PRINTED",
    );
    // every movement has its audit row
    const audit = await fx.prisma.auditLog.findMany({
      where: { resourceId: item.id, action: "INVENTORY_MOVEMENT" },
    });
    expect(audit.some((a) => (a.metadata as { printJobId?: string }).printJobId === job)).toBe(
      true,
    );
  });

  it("double-sided consumes half the sheets, rounded up per copy", async () => {
    const item = await stock(100);
    await printed(await seedJob("PRINTING", 2, config({ sides: "DOUBLE" }))); // ceil(5/2)=3 x 2
    expect(await qty(item.id)).toBe(94);
  });

  it("tracking OFF (default): nothing is consumed, no movement rows -- flag-off behaviour unchanged", async () => {
    await setTracking(false);
    const item = await stock(100);
    const job = await seedJob();
    await printed(job);
    expect(await qty(item.id)).toBe(100);
    expect(await movementsFor(job)).toHaveLength(0);
  });

  it("FAILED, TIMEOUT and CANCELLED consume nothing", async () => {
    const item = await stock(100);
    await machine.transition(await seedJob("PRINTING"), PrintJobEvent.FAIL, { id: null });
    await machine.transition(await seedJob("QUEUED"), PrintJobEvent.TIMEOUT, { id: null });
    await machine.transition(await seedJob("QUEUED"), PrintJobEvent.CANCEL, { id: null });
    expect(await qty(item.id)).toBe(100);
  });

  it("staff resolving UNKNOWN as printed consumes; resolving as failed does not", async () => {
    const item = await stock(100);
    await machine.transition(await seedJob("UNKNOWN"), PrintJobEvent.RESOLVE_FAILED, {
      id: fx.owner.id,
    });
    expect(await qty(item.id)).toBe(100);
    await machine.transition(await seedJob("UNKNOWN"), PrintJobEvent.RESOLVE_PRINTED, {
      id: fx.owner.id,
    });
    expect(await qty(item.id)).toBe(95);
  });

  it("a replayed PRINTED is refused and consumes nothing more (one movement per job)", async () => {
    const item = await stock(100);
    const job = await seedJob();
    await printed(job);
    const replay = await printed(job).catch((e: unknown) => e);
    expect((replay as AppException).errorCode).toBe("ILLEGAL_JOB_TRANSITION");
    expect(await qty(item.id)).toBe(95);
    expect(await movementsFor(job)).toHaveLength(1);
  });

  it("the database refuses a second consumption for the same job and item even if the code path were bypassed", async () => {
    const item = await stock(100);
    const job = await seedJob();
    await printed(job);
    await expect(
      fx.prisma.inventoryMovement.create({
        data: {
          shopId: fx.shop.id,
          inventoryItemId: item.id,
          type: "CONSUMPTION",
          quantityDelta: -5,
          quantityAfter: 90,
          printJobId: job,
          idempotencyKey: `consumption:${job}:${item.id}`,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("concurrent completions never oversell: 6 jobs x 5 sheets against 12 sheets -> stock ends at 0, consumed total is exactly 12, never negative", async () => {
    for (let round = 0; round < 3; round += 1) {
      await fx.prisma.inventoryItem.deleteMany({ where: { shopId: fx.shop.id } });
      const item = await stock(12);
      const jobs = await Promise.all(Array.from({ length: 6 }, () => seedJob()));
      const results = await Promise.allSettled(jobs.map((id) => printed(id)));
      // completing a job that already printed is never blocked by missing stock
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(await qty(item.id)).toBe(0);
      const rows = await fx.prisma.inventoryMovement.findMany({
        where: { inventoryItemId: item.id },
      });
      expect(rows.reduce((sum, r) => sum + r.quantityDelta, 0)).toBe(-12);
      expect(rows.every((r) => r.quantityAfter >= 0)).toBe(true);
      // the jobs that could not be fully covered left a shortfall audit trail
      const shortfalls = await fx.prisma.auditLog.findMany({
        where: { action: "INVENTORY_SHORTFALL", resourceId: { in: jobs } },
      });
      expect(shortfalls.length).toBeGreaterThan(0);
    }
  });

  it("insufficient stock never blocks PRINTED: takes what is there and audits the shortfall", async () => {
    const item = await stock(3);
    const job = await seedJob(); // needs 5
    await printed(job);
    expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job } })).status).toBe(
      "PRINTED",
    );
    expect(await qty(item.id)).toBe(0);
    const rows = await movementsFor(job);
    expect(rows.map((r) => r.quantityDelta)).toEqual([-3]);
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "INVENTORY_SHORTFALL", resourceId: job },
    });
    expect(audit.metadata).toMatchObject({
      requiredSheets: 5,
      consumedSheets: 3,
      shortfallSheets: 2,
    });
  });

  it("no matching stock at all: PRINTED still succeeds, no movement, shortfall audited", async () => {
    await stock(100, { paperSize: "A3" });
    const job = await seedJob();
    await printed(job);
    expect(await movementsFor(job)).toHaveLength(0);
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "INVENTORY_SHORTFALL", resourceId: job },
    });
    expect(audit.metadata).toMatchObject({
      requiredSheets: 5,
      consumedSheets: 0,
      shortfallSheets: 5,
    });
  });

  it("prefers the exactly-typed item, then untyped; spills across items; ignores other sizes and inactive items", async () => {
    const untyped = await stock(100, { paperType: null, name: "untyped" });
    const exact = await stock(3, { name: "exact" });
    const wrongSize = await stock(100, { paperSize: "A3" });
    const inactive = await stock(100, { active: false });
    const wrongType = await stock(100, { paperType: "PREMIUM" });
    const job = await seedJob(); // STANDARD, 5 sheets
    await printed(job);
    expect(await qty(exact.id)).toBe(0); // exact first, all 3
    expect(await qty(untyped.id)).toBe(98); // the remaining 2
    for (const untouched of [wrongSize, inactive, wrongType]) {
      expect(await qty(untouched.id)).toBe(100);
    }
    expect(await movementsFor(job)).toHaveLength(2);
  });

  it("items without a paper size (toner, staples) are never consumed as paper", async () => {
    const toner = await stock(100, { paperSize: null, paperType: null, name: "toner" });
    await printed(await seedJob());
    expect(await qty(toner.id)).toBe(100);
  });

  it("consumption is rolled back with the transition: a failing transition consumes nothing", async () => {
    const item = await stock(100);
    const job = await seedJob();
    await expect(
      machine.transition(
        job,
        PrintJobEvent.PRINTED,
        { id: null },
        {
          beforeSync: async () => {
            throw new Error("boom after consumption");
          },
        },
      ),
    ).rejects.toThrow("boom after consumption");
    expect(await qty(item.id)).toBe(100);
    expect(await movementsFor(job)).toHaveLength(0);
    expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job } })).status).toBe(
      "PRINTING",
    );
  });
});
