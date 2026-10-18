import {
  PrismaService,
  PrintJobStateMachine,
  reallocateWaitingJobs,
} from "@print-automated/backend-shared";
import { OrderStatus } from "@prisma/client";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";
import { branchIdOf } from "./helpers/branches.js";

/** 19.19 (PRD 122). Queue recovery reads the shop's opt-in flag once to pick
 * shops, but the shop can turn the toggle off while a tick is mid-flight. The
 * flag is re-checked inside the guard under the locks, so a shop that opted out
 * between the read and the write is never auto-allocated. */
describe("Queue recovery re-checks the opt-in under the locks (19.19, e2e)", () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await createPhase19Fixture("recovery-toggle", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  async function seedWaiting() {
    const { orderId, itemIds } = await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT);
    const job = await fx.prisma.printJob.create({
      data: {
        orderId,
        shopId: fx.shop.id,
        branchId: await branchIdOf(fx.prisma, fx.shop.id),
        orderItemId: itemIds[0]!,
        printerId: null,
        status: "WAITING",
        blockedReason: "PRINTER_OFFLINE",
        idempotencyToken: `${itemIds[0]}:1`,
      },
    });
    return job.id;
  }

  it("a toggle switched off after the candidate read leaves the job WAITING, unallocated and unaudited", async () => {
    await fx.makePrinter("T-A");
    const prisma = fx.app.get(PrismaService);
    const machine = fx.app.get(PrintJobStateMachine);
    const jobId = await seedWaiting();

    const result = await reallocateWaitingJobs(
      {
        prisma,
        jobMachine: machine,
        afterCandidatesRead: async () => {
          await prisma.shop.update({
            where: { id: fx.shop.id },
            data: { autoFailoverEnabled: false },
          });
        },
      },
      { shopId: fx.shop.id },
    );

    expect(result.errors).toEqual([]);
    expect(result.outcomes).toEqual([{ jobId, action: "SKIPPED" }]);
    const after = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.status).toBe("WAITING");
    expect(after.printerId).toBeNull();
    expect(
      await fx.prisma.auditLog.count({
        where: { resourceId: jobId, action: "PRINT_JOB_ALLOCATE" },
      }),
    ).toBe(0);
    expect(result.notifyDeviceIds).toEqual([]);
  });

  it("a toggle switched off concurrently (Promise.all) is never allocated after the write lands", async () => {
    await fx.prisma.shop.update({ where: { id: fx.shop.id }, data: { autoFailoverEnabled: true } });
    const prisma = fx.app.get(PrismaService);
    const machine = fx.app.get(PrintJobStateMachine);
    const jobId = await seedWaiting();
    await Promise.all([
      reallocateWaitingJobs({ prisma, jobMachine: machine }, { shopId: fx.shop.id }),
      prisma.shop.update({ where: { id: fx.shop.id }, data: { autoFailoverEnabled: false } }),
    ]);
    // either order is legal, but a job allocated must have been allocated while the flag was on;
    // after the toggle is off, another tick must never move it.
    const before = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    await reallocateWaitingJobs({ prisma, jobMachine: machine }, { shopId: fx.shop.id });
    const after = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(after.status).toBe(before.status);
  });
});
