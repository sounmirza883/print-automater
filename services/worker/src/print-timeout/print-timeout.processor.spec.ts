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
          { id: "job-3", orderId: "order-3" },
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
    transition.mockResolvedValueOnce([]);
    const result = await build(transition).process(fakeJob);
    expect(result).toEqual({ timedOutCount: 2, consideredCount: 3 });
    expect(transition).toHaveBeenCalledTimes(3);
    expect(transition).toHaveBeenLastCalledWith(
      "job-3",
      PrintJobEvent.TIMEOUT,
      { id: null },
      { metadata: { reason: "timeout" } },
    );
  });

  it("18.27: a poison job first in the list does not stop jobs 2 and 3 from timing out, and its error is still surfaced after the loop", async () => {
    const transition = jest
      .fn()
      .mockRejectedValueOnce(new AppException(503, "ORDER_SYNC_UNAVAILABLE", "boom", true))
      .mockResolvedValue([]);
    await expect(build(transition).process(fakeJob)).rejects.toMatchObject({
      errorCode: "ORDER_SYNC_UNAVAILABLE",
    });
    expect(transition).toHaveBeenCalledTimes(3);
    expect(transition.mock.calls.map((call) => call[0])).toEqual(["job-1", "job-2", "job-3"]);
  });

  it("18.27: a poison job in the middle: earlier and later jobs still time out; a non-AppException error is surfaced too", async () => {
    const transition = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([]);
    await expect(build(transition).process(fakeJob)).rejects.toThrow("db down");
    expect(transition).toHaveBeenCalledTimes(3);
  });

  it("18.27: several failures are all reported (AggregateError), each job still attempted", async () => {
    const transition = jest
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValueOnce([]);
    const error = await build(transition)
      .process(fakeJob)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      "first",
      "second",
    ]);
    expect(transition).toHaveBeenCalledTimes(3);
  });

  it("ILLEGAL_JOB_TRANSITION alone is a quiet no-op: the tick completes without throwing", async () => {
    const transition = jest
      .fn()
      .mockRejectedValue(new AppException(409, "ILLEGAL_JOB_TRANSITION", "moved on", false));
    await expect(build(transition).process(fakeJob)).resolves.toEqual({
      timedOutCount: 0,
      consideredCount: 3,
    });
  });
});
