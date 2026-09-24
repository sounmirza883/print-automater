import type { Job } from "bullmq";
import type Redis from "ioredis";
import type { PrintJobStateMachine, PrismaService } from "@print-automated/backend-shared";
import { PrinterOfflineSweepProcessor } from "./printer-offline-sweep.processor.js";

const reevaluate = jest.fn();
const signal = jest.fn();
const reallocate = jest.fn();
jest.mock("@print-automated/backend-shared", () => ({
  ...jest.requireActual("@print-automated/backend-shared"),
  reevaluatePrinterJobs: (...args: unknown[]) => reevaluate(...args),
  reallocateWaitingJobs: (...args: unknown[]) => reallocate(...args),
  signalAgentDevice: (...args: unknown[]) => signal(...args),
}));

/** 19.14: failover is driven ONLY by the rows the sweep's own UPDATE .. RETURNING
 * flipped, and only for opted-in shops. No infrastructure: everything is stubbed. */
describe("PrinterOfflineSweepProcessor failover wiring (19.14)", () => {
  const fakeJob = {} as Job;

  function build(flipped: Array<{ id: string; shopId: string }>, optedInShopIds: string[]) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue(flipped),
      shop: {
        findMany: jest.fn().mockResolvedValue(optedInShopIds.map((id) => ({ id }))),
      },
    } as unknown as PrismaService;
    return new PrinterOfflineSweepProcessor(
      prisma,
      {} as PrintJobStateMachine,
      {} as unknown as Redis,
    );
  }

  beforeEach(() => {
    reevaluate.mockReset();
    signal.mockReset();
    reallocate.mockReset();
    reevaluate.mockResolvedValue({ outcomes: [], errors: [], notifyDeviceIds: [] });
    reallocate.mockResolvedValue({ outcomes: [], errors: [], notifyDeviceIds: [] });
  });

  it("does nothing beyond the flip when no printer changed state (no failover)", async () => {
    const processor = build([], []);
    await expect(processor.process(fakeJob)).resolves.toEqual({
      markedOfflineCount: 0,
      failoverErrors: 0,
      reallocatedCount: 0,
    });
    expect(reevaluate).not.toHaveBeenCalled();
  });

  it("re-evaluates only printers of shops that opted in", async () => {
    const processor = build(
      [
        { id: "p-on", shopId: "shop-on" },
        { id: "p-off", shopId: "shop-off" },
      ],
      ["shop-on"],
    );
    await processor.process(fakeJob);
    expect(reevaluate).toHaveBeenCalledTimes(1);
    expect(reevaluate.mock.calls[0]?.[1]).toEqual({
      shopId: "shop-on",
      printerId: "p-on",
      trigger: "PRINTER_ERROR",
    });
  });

  it("wakes each receiving agent after its moves, and one printer's failure does not stop the next", async () => {
    reevaluate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ outcomes: [], errors: [], notifyDeviceIds: ["dev-1", "dev-2"] });
    const processor = build(
      [
        { id: "p1", shopId: "s" },
        { id: "p2", shopId: "s" },
      ],
      ["s"],
    );
    const result = await processor.process(fakeJob);
    expect(result).toEqual({ markedOfflineCount: 2, failoverErrors: 1, reallocatedCount: 0 });
    expect(signal).toHaveBeenCalledTimes(2);
  });

  it("19.15: wakes the agents of re-allocated jobs, and a failing recovery cannot fail the tick", async () => {
    reallocate.mockResolvedValueOnce({
      outcomes: [{ jobId: "j", action: "ALLOCATED", printerId: "p" }],
      errors: [],
      notifyDeviceIds: ["dev-9"],
    });
    const processor = build([], []);
    await expect(processor.process(fakeJob)).resolves.toMatchObject({ reallocatedCount: 1 });
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal.mock.calls[0]?.[1]).toBe("dev-9");

    reallocate.mockRejectedValueOnce(new Error("db down"));
    await expect(build([], []).process(fakeJob)).resolves.toMatchObject({ reallocatedCount: 0 });
  });
});
