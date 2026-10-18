import "reflect-metadata";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import type { Job } from "bullmq";
import { PrinterAgentStatus, PrinterStatus, ShopStatus } from "@prisma/client";
import { PrismaService } from "@print-automated/backend-shared";
import { AppModule } from "../src/app.module.js";
import { PrinterOfflineSweepProcessor } from "../src/printer-offline-sweep/printer-offline-sweep.processor.js";
import { branchIdOf } from "./helpers/branches.js";

/** 9.4's other half: "killing the agent flips its printers to Offline
 * within the threshold, not silently." Drives the processor directly,
 * same style 5.6's own order-expiration sweep test uses. */
describe("Printer offline sweep (9.4, e2e)", () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let processor: PrinterOfflineSweepProcessor;
  let shopId: string;
  const fakeJob = {} as Job;
  const printerIds: string[] = [];
  const agentIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    prisma = app.get(PrismaService);
    processor = app.get(PrinterOfflineSweepProcessor);

    const shop = await prisma.shop.create({
      data: {
        name: `Printer Sweep E2E Shop ${randomUUID()}`,
        address: "1 Test Street",
        status: ShopStatus.OPEN,
      },
    });
    shopId = shop.id;
  });

  afterAll(async () => {
    await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    await prisma.printerAgent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.shop.delete({ where: { id: shopId } });
    await app.close();
  });

  async function createAgent(lastSeenAgoMs: number | null): Promise<string> {
    const agent = await prisma.printerAgent.create({
      data: {
        deviceId: randomUUID(),
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        publicKey: "irrelevant-for-this-test",
        status: PrinterAgentStatus.ACTIVE,
        lastSeenAt: lastSeenAgoMs === null ? null : new Date(Date.now() - lastSeenAgoMs),
      },
    });
    agentIds.push(agent.id);
    return agent.id;
  }

  async function createPrinter(agentId: string | null, status: PrinterStatus): Promise<string> {
    const printer = await prisma.printer.create({
      data: {
        shopId,
        branchId: await branchIdOf(prisma, shopId),
        agentId,
        name: `Sweep Test Printer ${randomUUID()}`,
        status,
      },
    });
    printerIds.push(printer.id);
    return printer.id;
  }

  it("marks ONLINE/ERROR printers OFFLINE once their agent's last heartbeat is past the threshold, or never sent one", async () => {
    const staleAgent = await createAgent(999_000);
    const stalePrinter = await createPrinter(staleAgent, PrinterStatus.ONLINE);
    const staleErrorPrinter = await createPrinter(staleAgent, PrinterStatus.ERROR);

    const neverHeartbeatAgent = await createAgent(null);
    const neverHeartbeatPrinter = await createPrinter(neverHeartbeatAgent, PrinterStatus.ONLINE);

    await processor.process(fakeJob);

    const [stale, staleError, neverHeartbeat] = await Promise.all([
      prisma.printer.findUniqueOrThrow({ where: { id: stalePrinter } }),
      prisma.printer.findUniqueOrThrow({ where: { id: staleErrorPrinter } }),
      prisma.printer.findUniqueOrThrow({ where: { id: neverHeartbeatPrinter } }),
    ]);
    expect(stale.status).toBe(PrinterStatus.OFFLINE);
    expect(staleError.status).toBe(PrinterStatus.OFFLINE);
    expect(neverHeartbeat.status).toBe(PrinterStatus.OFFLINE);
  });

  it("leaves a printer alone whose agent heartbeated recently", async () => {
    const freshAgent = await createAgent(1000);
    const freshPrinter = await createPrinter(freshAgent, PrinterStatus.ONLINE);

    await processor.process(fakeJob);

    const printer = await prisma.printer.findUniqueOrThrow({ where: { id: freshPrinter } });
    expect(printer.status).toBe(PrinterStatus.ONLINE);
  });

  it("never touches a DISABLED printer, even with a stale/missing agent -- staff's own override wins", async () => {
    const staleAgent = await createAgent(999_000);
    const disabledPrinter = await createPrinter(staleAgent, PrinterStatus.DISABLED);

    await processor.process(fakeJob);

    const printer = await prisma.printer.findUniqueOrThrow({ where: { id: disabledPrinter } });
    expect(printer.status).toBe(PrinterStatus.DISABLED);
  });

  it("never touches a printer with no agent linked at all", async () => {
    const unlinkedPrinter = await createPrinter(null, PrinterStatus.ONLINE);

    await processor.process(fakeJob);

    const printer = await prisma.printer.findUniqueOrThrow({ where: { id: unlinkedPrinter } });
    expect(printer.status).toBe(PrinterStatus.ONLINE);
  });
});
