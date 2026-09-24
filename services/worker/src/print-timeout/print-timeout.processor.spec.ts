import type { Job } from "bullmq";
import { AppException, PrintJobEvent } from "@print-automated/backend-shared";
import type { PrismaService, PrintJobStateMachine } from "@print-automated/backend-shared";
import type { WorkerEnv } from "@print-automated/config";
import { PrintTimeoutProcessor } from "./print-timeout.processor.js";

/** 18.16: the sweep's catch is narrowed to ILLEGAL_JOB_TRANSITION (the job
 * already moved on). Everything else -- including any other AppException
 * from the order sync that now runs inside the job transaction -- must
 * propagate so the tick is logged and retried. No infrastructure needed:
 * the state machine and Prisma are stubbed. */
describe("PrintTimeoutProcessor error handling (18.16)", () => {
  function build(transition: jest.Mock): PrintTimeoutProcessor {
    const prisma = {
      printJob: {
        findMany: jest.fn().mockResolvedValue([
          { id: "job-1", orderId: "order-1" },
          { id: "job-2", orderId: "order-2" },
        ]),
      },
    } as unknown as PrismaService;
    const machine = { transition } as unknown as PrintJobStateMachine;
    return new PrintTimeoutProcessor(prisma, machine, {
      PRINT_JOB_TIMEOUT_MINUTES: 10,
    } as unknown as WorkerEnv);
  }

  const fakeJob = {} as Job;

  it("skips a job whose transition is ILLEGAL_JOB_TRANSITION and carries on with the next", async () => {
    const transition = jest
      .fn()
      .mockRejectedValueOnce(
        new AppException(409, "ILLEGAL_JOB_TRANSITION", "already moved on", false),
      )
      .mockResolvedValueOnce([]);
    const result = await build(transition).process(fakeJob);
    expect(result).toEqual({ timedOutCount: 1, consideredCount: 2 });
    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenLastCalledWith(
      "job-2",
      PrintJobEvent.TIMEOUT,
      { id: null },
      { metadata: { reason: "timeout" } },
    );
  });

  it("does NOT swallow any other AppException (e.g. a failed order sync)", async () => {
    const transition = jest
      .fn()
      .mockRejectedValue(new AppException(503, "ORDER_SYNC_UNAVAILABLE", "boom", true));
    await expect(build(transition).process(fakeJob)).rejects.toMatchObject({
      errorCode: "ORDER_SYNC_UNAVAILABLE",
    });
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it("does NOT swallow a non-AppException error", async () => {
    const transition = jest.fn().mockRejectedValue(new Error("db down"));
    await expect(build(transition).process(fakeJob)).rejects.toThrow("db down");
  });
});
