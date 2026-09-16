import type pino from "pino";
import { monitorPrintJob } from "./monitor-print-job.js";
import { queryPrintJobs, type QueueSnapshot } from "./print-queue.js";

jest.mock("./print-queue.js", () => ({
  queryPrintJobs: jest.fn(),
}));

const mockedQueryPrintJobs = queryPrintJobs as jest.MockedFunction<typeof queryPrintJobs>;

function silentLogger(): pino.Logger {
  return { warn: jest.fn() } as unknown as pino.Logger;
}

function job(jobId: number, overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    jobId,
    status: "Printing",
    jobStatus: "Printing",
    pagesPrinted: 0,
    totalPages: 1,
    ...overrides,
  };
}

/** §9.11's own polling loop, tested against a scripted sequence of
 * queryPrintJobs() results (mocked -- the real WMI call is I/O this
 * function doesn't own) with real timer advancement, proving the
 * 2s-interval poll-until-verdict-or-deadline shape actually works,
 * not just PrintJobTracker's own pure logic in isolation. */
describe("monitorPrintJob (9.11)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedQueryPrintJobs.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("polls every 2s by default and resolves PRINTED once the tracked job vanishes", async () => {
    mockedQueryPrintJobs
      .mockResolvedValueOnce([job(5)])
      .mockResolvedValueOnce([job(5)])
      .mockResolvedValueOnce([]);

    const resultPromise = monitorPrintJob("Fixture Printer", new Set(), silentLogger());

    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toBe("PRINTED");
    expect(mockedQueryPrintJobs).toHaveBeenCalledTimes(3);
  });

  it("resolves UNKNOWN once the timeout elapses with the job never observed", async () => {
    mockedQueryPrintJobs.mockResolvedValue([]);

    const resultPromise = monitorPrintJob("Fixture Printer", new Set(), silentLogger(), {
      pollIntervalMs: 1_000,
      timeoutMs: 3_000,
    });

    await jest.advanceTimersByTimeAsync(5_000);

    await expect(resultPromise).resolves.toBe("UNKNOWN");
  });

  it("resolves FAILED once the timeout elapses with the job still present and having shown an error", async () => {
    mockedQueryPrintJobs.mockResolvedValue([job(5, { status: "Error", jobStatus: "Paper Jam" })]);

    const resultPromise = monitorPrintJob("Fixture Printer", new Set(), silentLogger(), {
      pollIntervalMs: 1_000,
      timeoutMs: 2_000,
    });

    await jest.advanceTimersByTimeAsync(3_000);

    await expect(resultPromise).resolves.toBe("FAILED");
  });
});
