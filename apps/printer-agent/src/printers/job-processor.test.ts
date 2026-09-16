import { createServer, type Server } from "node:http";
import { stat } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type pino from "pino";
import { ColorMode, Orientation, PaperSize, Sides } from "@print-automated/types";
import { BackendClient } from "../backend/backend-client.js";
import { ensureConfigDirs, TMP_DIR } from "../config/paths.js";
import { JobLedger } from "../ledger/ledger.js";
import { markUnresolvedAsUnknown } from "../ledger/startup-sweep.js";
import { FakePrinterDriver } from "./driver/fake-driver.js";
import type { PrintOptions, PrinterDriver, PrintSubmission } from "./driver/printer-driver.js";
import { processNextJob } from "./job-processor.js";
import { queryPrintJobs } from "./monitor/print-queue.js";

jest.mock("./monitor/print-queue.js", () => ({
  queryPrintJobs: jest.fn(),
}));

const mockedQueryPrintJobs = queryPrintJobs as jest.MockedFunction<typeof queryPrintJobs>;

const PDF_BYTES = Buffer.from("%PDF-1.7\njob processor fixture\n%%EOF");

const JOB = {
  id: "job-1",
  orderId: "order-1",
  printerId: "printer-1",
  printerName: "Fixture Printer",
  status: "QUEUED",
  claimedAt: null,
  createdAt: new Date().toISOString(),
  printConfiguration: {
    pages: { mode: "all" as const },
    copies: 1,
    paperSize: PaperSize.A4,
    color: ColorMode.COLOR,
    sides: Sides.SINGLE,
    orientation: Orientation.PORTRAIT,
  },
};

function silentLogger(): pino.Logger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as pino.Logger;
}

/** Simulates the print command failing before it ever reached the
 * spooler (e.g. the binary wasn't found) -- the one case job-
 * processor.ts can confidently mark FAILED on its own, per its own
 * comment. */
class ThrowingPrinterDriver implements PrinterDriver {
  print(_options: PrintOptions): Promise<PrintSubmission> {
    return Promise.reject(new Error("SumatraPDF.exe not found"));
  }
}

/** §9.9/§15's own "full job lifecycle runs green in CI against
 * FakePrinterDriver" -- against a real node:http server standing in
 * for the backend (real bytes over a real socket, matching 9.8's
 * document-fetch.test.ts precedent), not a mocked fetch, so this
 * proves the poll -> claim -> fetch -> print calling sequence and its
 * error handling, hermetically, with no live API or hardware needed.
 * Each test opens its own JobLedger against a fresh temp sqlite file
 * -- 9.10's own crash-restart scenario is tested by closing one
 * instance and opening a second against the SAME file, which a
 * shared/in-memory ledger couldn't demonstrate at all. */
describe("processNextJob (9.9/9.10/9.11)", () => {
  let server: Server;
  let baseUrl: string;
  let claimStatus = 200;
  let jobAvailable = true;
  const ledgerPaths: string[] = [];
  const statusReports: Array<{ status: string; idempotencyKey: string | undefined }> = [];

  beforeAll(async () => {
    ensureConfigDirs();
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/v1/agents/jobs") {
        if (!jobAvailable) {
          res.writeHead(204).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(JOB));
        return;
      }

      if (req.method === "POST" && url.pathname === `/v1/agents/jobs/${JOB.id}/claim`) {
        if (claimStatus !== 200) {
          res.writeHead(claimStatus, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error_code: "JOB_ALREADY_CLAIMED",
              message: "taken",
              retryable: false,
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...JOB, status: "CLAIMED", claimedAt: new Date().toISOString() }));
        return;
      }

      if (req.method === "GET" && url.pathname === `/v1/agents/jobs/${JOB.id}/document`) {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end(PDF_BYTES);
        return;
      }

      if (req.method === "POST" && url.pathname === `/v1/agents/jobs/${JOB.id}/status`) {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          const parsed = JSON.parse(body) as { status: string };
          statusReports.push({
            status: parsed.status,
            idempotencyKey: req.headers["idempotency-key"] as string | undefined,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end("");
        });
        return;
      }

      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("failed to bind fixture server");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    for (const path of ledgerPaths) {
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    }
  });

  beforeEach(() => {
    claimStatus = 200;
    jobAvailable = true;
    statusReports.length = 0;
    // 9.11's own monitor: a real Win32_PrintJob poll is I/O this suite
    // doesn't own (print-job-tracker.test.ts and monitor-print-job.
    // test.ts already cover it in isolation) -- default to "job seen,
    // then gone" so processNextJob's own tests get a fast, deterministic
    // PRINTED without waiting on real polling intervals.
    mockedQueryPrintJobs
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { jobId: 1, status: "Printing", jobStatus: "Printing", pagesPrinted: 0, totalPages: 1 },
      ])
      .mockResolvedValue([]);
  });

  const FAST_MONITOR_OPTIONS = { pollIntervalMs: 10, timeoutMs: 500 };

  function newLedger(): JobLedger {
    const path = join(TMP_DIR, `job-processor-test-${randomUUID()}.sqlite`);
    ledgerPaths.push(path);
    return new JobLedger(path);
  }

  it("returns no-job and never touches the driver when nothing is queued", async () => {
    jobAvailable = false;
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();
    const ledger = newLedger();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      ledger,
      logger: silentLogger(),
      monitorOptions: FAST_MONITOR_OPTIONS,
    });

    expect(result).toEqual({ outcome: "no-job" });
    expect(driver.submissions).toHaveLength(0);
    ledger.close();
  });

  it("polls, claims, fetches the document, submits it to the driver, and monitors it to a PRINTED verdict -- with the temp file gone afterward", async () => {
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();
    const ledger = newLedger();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      ledger,
      logger: silentLogger(),
      monitorOptions: FAST_MONITOR_OPTIONS,
    });

    expect(result).toMatchObject({ outcome: "printed", jobId: JOB.id, printOutcome: "PRINTED" });
    expect(driver.submissions).toHaveLength(1);
    expect(driver.submissions[0]?.printerName).toBe("Fixture Printer");
    expect(driver.submissions[0]?.configuration).toEqual(JOB.printConfiguration);

    const filePath = driver.submissions[0]?.filePath;
    expect(filePath).toBeDefined();
    await expect(stat(filePath as unknown as string)).rejects.toThrow();

    // §9.9/9.11's own driver.print() contract: "submitted to the
    // spooler" is not "printed" -- the monitor is what finally
    // resolves the ledger row 9.10's claim() left open.
    const row = ledger.getByJobId(JOB.id);
    expect(row?.result).toBe("PRINTED");
    ledger.close();

    // §9.12: both the interim "started printing" report and the final
    // verdict actually reached the backend, each under its own
    // deterministic idempotency key.
    expect(statusReports).toEqual([
      { status: "PRINTING", idempotencyKey: `${JOB.id}:PRINTING` },
      { status: "PRINTED", idempotencyKey: `${JOB.id}:PRINTED` },
    ]);
  });

  it("backs off cleanly on a lost claim race, without ever fetching the document, calling the driver, or writing a ledger row", async () => {
    claimStatus = 409;
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();
    const ledger = newLedger();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      ledger,
      logger: silentLogger(),
      monitorOptions: FAST_MONITOR_OPTIONS,
    });

    expect(result).toEqual({ outcome: "lost-race" });
    expect(driver.submissions).toHaveLength(0);
    expect(ledger.getByJobId(JOB.id)).toBeNull();
    ledger.close();
  });

  it("§9.10: a driver failure before reaching the spooler is recorded FAILED in the ledger, not left unresolved", async () => {
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new ThrowingPrinterDriver();
    const ledger = newLedger();

    await expect(
      processNextJob(client, "token", {
        baseUrl,
        driver,
        ledger,
        logger: silentLogger(),
        monitorOptions: FAST_MONITOR_OPTIONS,
      }),
    ).rejects.toThrow("SumatraPDF.exe not found");

    const row = ledger.getByJobId(JOB.id);
    expect(row?.result).toBe("FAILED");
    ledger.close();
  });

  it("§9.10's own Done-when: a job claimed but never resolved before this process ends is marked PRINT_STATUS_UNKNOWN on the next restart, not silently resubmitted", () => {
    const path = join(TMP_DIR, `job-processor-restart-test-${randomUUID()}.sqlite`);
    ledgerPaths.push(path);

    // Simulates the exact crash window §9.10 describes: the ledger
    // row is written (and, given ledger.ts's own synchronous=FULL
    // pragma, durably fsync'd) but the process is killed before ever
    // calling recordResult() -- represented here by simply never
    // calling it, then closing this "run" of the ledger.
    const firstRun = new JobLedger(path);
    firstRun.claim("crashed-job", "order-9", "Fixture Printer");
    firstRun.close();

    // A fresh process, pointed at the same on-disk file -- runs the
    // exact same sweep index.ts's own startup runs.
    const secondRun = new JobLedger(path);
    const unresolvedBeforeSweep = secondRun.getUnresolved();
    expect(unresolvedBeforeSweep).toHaveLength(1);
    expect(unresolvedBeforeSweep[0]?.jobId).toBe("crashed-job");

    const sweptCount = markUnresolvedAsUnknown(secondRun, silentLogger());
    expect(sweptCount).toBe(1);

    const resolved = secondRun.getByJobId("crashed-job");
    expect(resolved?.result).toBe("UNKNOWN");
    expect(secondRun.getUnresolved()).toHaveLength(0);
    secondRun.close();
  });
});
