import { createServer, type Server } from "node:http";
import { stat } from "node:fs/promises";
import type pino from "pino";
import { ColorMode, Orientation, PaperSize, Sides } from "@print-automated/types";
import { BackendClient } from "../backend/backend-client.js";
import { ensureConfigDirs } from "../config/paths.js";
import { FakePrinterDriver } from "./driver/fake-driver.js";
import { processNextJob } from "./job-processor.js";

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
  return { info: jest.fn(), warn: jest.fn() } as unknown as pino.Logger;
}

/** §9.9/§15's own "full job lifecycle runs green in CI against
 * FakePrinterDriver" -- against a real node:http server standing in
 * for the backend (real bytes over a real socket, matching 9.8's
 * document-fetch.test.ts precedent), not a mocked fetch, so this
 * proves the poll -> claim -> fetch -> print calling sequence and its
 * error handling, hermetically, with no live API or hardware needed. */
describe("processNextJob (9.9)", () => {
  let server: Server;
  let baseUrl: string;
  let claimStatus = 200;
  let jobAvailable = true;

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
  });

  beforeEach(() => {
    claimStatus = 200;
    jobAvailable = true;
  });

  it("returns no-job and never touches the driver when nothing is queued", async () => {
    jobAvailable = false;
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      logger: silentLogger(),
    });

    expect(result).toEqual({ outcome: "no-job" });
    expect(driver.submissions).toHaveLength(0);
  });

  it("polls, claims, fetches the document, and submits it to the driver -- with the temp file gone afterward", async () => {
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      logger: silentLogger(),
    });

    expect(result.outcome).toBe("printed");
    expect(driver.submissions).toHaveLength(1);
    expect(driver.submissions[0]?.printerName).toBe("Fixture Printer");
    expect(driver.submissions[0]?.configuration).toEqual(JOB.printConfiguration);

    const filePath = driver.submissions[0]?.filePath;
    expect(filePath).toBeDefined();
    await expect(stat(filePath as unknown as string)).rejects.toThrow();
  });

  it("backs off cleanly on a lost claim race, without ever fetching the document or calling the driver", async () => {
    claimStatus = 409;
    const client = new BackendClient(baseUrl, silentLogger());
    const driver = new FakePrinterDriver();

    const result = await processNextJob(client, "token", {
      baseUrl,
      driver,
      logger: silentLogger(),
    });

    expect(result).toEqual({ outcome: "lost-race" });
    expect(driver.submissions).toHaveLength(0);
  });
});
