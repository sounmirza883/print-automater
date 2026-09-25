import "reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import { getQueueToken } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { ShopStatus } from "@prisma/client";
import { PrismaService, QUEUE_NAMES } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { LowStockAlertProcessor } from "../src/low-stock-alerts/low-stock-alert.processor.js";

/** 20.5 / PRD 32: the low-stock alert sweep. Drives the real processor. */
describe("Low-stock alert worker (20.5, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let processor: LowStockAlertProcessor;
  const fakeJob = {} as Job;
  const shopIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    processor = app.get(LowStockAlertProcessor);
  });
  afterAll(async () => {
    // Shop delete cascades items, movements and alerts.
    await prisma.shop.deleteMany({ where: { id: { in: shopIds } } });
    await app.close();
  });

  async function shop(tracking: boolean) {
    const s = await prisma.shop.create({
      data: {
        name: `low-stock ${randomUUID()}`,
        address: "1",
        status: ShopStatus.OPEN,
        inventoryTrackingEnabled: tracking,
      },
    });
    shopIds.push(s.id);
    return s;
  }
  const item = (shopId: string, quantity: number, minQuantity: number, extra: object = {}) =>
    prisma.inventoryItem.create({
      data: {
        shopId,
        name: `A4 ${randomUUID()}`,
        paperSize: "A4",
        quantity,
        minQuantity,
        ...extra,
      },
    });
  const alertsOf = (itemId: string) =>
    prisma.inventoryAlert.findMany({
      where: { inventoryItemId: itemId },
      orderBy: { createdAt: "asc" },
    });

  it("raises one OPEN alert when stock reaches the minimum, with the level at the time", async () => {
    const s = await shop(true);
    const low = await item(s.id, 100, 100);
    const fine = await item(s.id, 101, 100);
    const noMin = await item(s.id, 0, 0);
    const result = await processor.process(fakeJob);
    expect(result.raised).toBeGreaterThanOrEqual(1);
    const alerts = await alertsOf(low.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      status: "OPEN",
      quantityAtAlert: 100,
      minQuantity: 100,
      shopId: s.id,
    });
    expect(await alertsOf(fine.id)).toHaveLength(0);
    expect(await alertsOf(noMin.id)).toHaveLength(0);
  });

  it("does not re-alert on later ticks while the item stays low (dedupe latch)", async () => {
    const s = await shop(true);
    const low = await item(s.id, 5, 10);
    await processor.process(fakeJob);
    await processor.process(fakeJob);
    await processor.process(fakeJob);
    expect(await alertsOf(low.id)).toHaveLength(1);
  });

  it("two overlapping ticks raise exactly one alert per item (Promise.all)", async () => {
    for (let round = 0; round < 4; round += 1) {
      const s = await shop(true);
      const items = await Promise.all(Array.from({ length: 5 }, () => item(s.id, 1, 10)));
      await Promise.all([
        processor.process(fakeJob),
        processor.process(fakeJob),
        processor.process(fakeJob),
      ]);
      for (const i of items) {
        expect(await alertsOf(i.id)).toHaveLength(1);
      }
    }
  });

  it("resolves the alert when stock recovers, and a later drop raises a NEW alert", async () => {
    const s = await shop(true);
    const i = await item(s.id, 2, 10);
    await processor.process(fakeJob);
    await prisma.inventoryItem.update({ where: { id: i.id }, data: { quantity: 500 } });
    const tick = await processor.process(fakeJob);
    expect(tick.resolved).toBeGreaterThanOrEqual(1);
    let alerts = await alertsOf(i.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe("RESOLVED");
    expect(alerts[0]!.resolvedAt).not.toBeNull();

    await prisma.inventoryItem.update({ where: { id: i.id }, data: { quantity: 3 } });
    await processor.process(fakeJob);
    alerts = await alertsOf(i.id);
    expect(alerts.map((a) => a.status)).toEqual(["RESOLVED", "OPEN"]);
  });

  it("raising a minimum above the current stock alerts; deactivating the item or clearing the minimum resolves", async () => {
    const s = await shop(true);
    const i = await item(s.id, 50, 0);
    await processor.process(fakeJob);
    expect(await alertsOf(i.id)).toHaveLength(0);
    await prisma.inventoryItem.update({ where: { id: i.id }, data: { minQuantity: 60 } });
    await processor.process(fakeJob);
    expect((await alertsOf(i.id))[0]!.status).toBe("OPEN");
    await prisma.inventoryItem.update({ where: { id: i.id }, data: { active: false } });
    await processor.process(fakeJob);
    expect((await alertsOf(i.id))[0]!.status).toBe("RESOLVED");
  });

  it("shops that do not track inventory (default) are never alerted, and inactive items are not alerted", async () => {
    const off = await shop(false);
    const a = await item(off.id, 0, 10);
    const on = await shop(true);
    const b = await item(on.id, 0, 10, { active: false });
    await processor.process(fakeJob);
    expect(await alertsOf(a.id)).toHaveLength(0);
    expect(await alertsOf(b.id)).toHaveLength(0);
  });

  it("never waits on an item row another transaction holds (lock order vs consumption): skips it this tick, alerts it on the next", async () => {
    const s = await shop(true);
    const held = await item(s.id, 1, 10);
    const free = await item(s.id, 1, 10);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another transaction (like a job completion consuming paper) holds the row lock.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM inventory_items WHERE id = ${held.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await lockTaken;
    const started = Date.now();
    const tick = await processor.process(fakeJob);
    const elapsed = Date.now() - started;
    // If the sweep queued behind the lock it would wait for `release` (never, here) and time out.
    expect(elapsed).toBeLessThan(5_000);
    expect(tick.raised).toBeGreaterThanOrEqual(1);
    expect(await alertsOf(free.id)).toHaveLength(1);
    expect(await alertsOf(held.id)).toHaveLength(0);
    release();
    await holder;
    await processor.process(fakeJob);
    expect(await alertsOf(held.id)).toHaveLength(1);
  });

  it("the sweep is registered as a repeatable job scheduler on its own queue", async () => {
    const queue = app.get<Queue>(getQueueToken(QUEUE_NAMES.LOW_STOCK_ALERTS), { strict: false });
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((sc) => sc.key)).toContain("low-stock-alerts");
  });
  it("22.2: automatic inventory alerts OFF raises nothing for that shop (others unaffected); ON raises them", async () => {
    const off = await shop(true);
    const on = await shop(true);
    await prisma.shopSettings.update({
      where: { shopId: off.id },
      data: { inventoryAlertsEnabled: false },
    });
    const lowOff = await item(off.id, 1, 10);
    const lowOn = await item(on.id, 1, 10);
    await processor.process(fakeJob);
    expect(await alertsOf(lowOff.id)).toHaveLength(0);
    expect(await alertsOf(lowOn.id)).toHaveLength(1);

    await prisma.shopSettings.update({
      where: { shopId: off.id },
      data: { inventoryAlertsEnabled: true },
    });
    await processor.process(fakeJob);
    expect(await alertsOf(lowOff.id)).toHaveLength(1);
  });

  it("22.2: switching alerts off does not strand an open alert: it still resolves when stock recovers", async () => {
    const s = await shop(true);
    const low = await item(s.id, 1, 10);
    await processor.process(fakeJob);
    expect(await alertsOf(low.id)).toHaveLength(1);
    await prisma.shopSettings.update({
      where: { shopId: s.id },
      data: { inventoryAlertsEnabled: false },
    });
    await prisma.inventoryItem.update({ where: { id: low.id }, data: { quantity: 500 } });
    await processor.process(fakeJob);
    expect((await alertsOf(low.id))[0]?.status).toBe("RESOLVED");
  });
});
