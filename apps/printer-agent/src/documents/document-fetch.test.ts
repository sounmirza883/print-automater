import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type pino from "pino";
import { ensureConfigDirs, TMP_DIR } from "../config/paths.js";
import { withJobDocument } from "./document-fetch.js";
import { BackendError } from "../backend/backend-client.js";

const PDF_BYTES = Buffer.from("%PDF-1.7\nfixture content\n%%EOF");

function silentLogger(): pino.Logger {
  return { warn: jest.fn() } as unknown as pino.Logger;
}

describe("withJobDocument (9.8)", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuthHeader: string | undefined;
  let respondWith: { status: number; body: Buffer | object } = { status: 200, body: PDF_BYTES };

  beforeAll(async () => {
    ensureConfigDirs();
    server = createServer((req, res) => {
      lastAuthHeader = req.headers.authorization;
      if (Buffer.isBuffer(respondWith.body)) {
        res.writeHead(respondWith.status, { "content-type": "application/pdf" });
        res.end(respondWith.body);
      } else {
        const json = JSON.stringify(respondWith.body);
        res.writeHead(respondWith.status, { "content-type": "application/json" });
        res.end(json);
      }
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
    respondWith = { status: 200, body: PDF_BYTES };
    lastAuthHeader = undefined;
  });

  it("writes the fetched bytes to a temp file, passes the path to the callback, then deletes it", async () => {
    let observedPath: string | null = null;
    let observedBytes: Buffer | null = null;

    const result = await withJobDocument(
      baseUrl,
      "job-1",
      "test-token",
      silentLogger(),
      async (filePath) => {
        observedPath = filePath;
        observedBytes = await readFile(filePath);
        return "callback result";
      },
    );

    expect(result).toBe("callback result");
    expect(observedPath).toContain(TMP_DIR);
    expect(observedBytes).not.toBeNull();
    expect((observedBytes as unknown as Buffer).equals(PDF_BYTES)).toBe(true);
    expect(lastAuthHeader).toBe("Bearer test-token");

    // §9.8's own Done-when: "no temp file survives a normal run."
    await expect(stat(observedPath as unknown as string)).rejects.toThrow();
  });

  it("deletes the temp file even when the callback throws", async () => {
    let observedPath: string | null = null;

    await expect(
      withJobDocument(baseUrl, "job-2", "test-token", silentLogger(), async (filePath) => {
        observedPath = filePath;
        throw new Error("print driver blew up");
      }),
    ).rejects.toThrow("print driver blew up");

    await expect(stat(observedPath as unknown as string)).rejects.toThrow();
  });

  it("throws BackendError and writes no file at all when the backend responds non-OK", async () => {
    respondWith = {
      status: 409,
      body: { error_code: "JOB_NOT_CLAIMED", message: "Not claimed.", retryable: false },
    };

    const fn = jest.fn();
    await expect(
      withJobDocument(baseUrl, "job-3", "test-token", silentLogger(), fn),
    ).rejects.toThrow(BackendError);
    expect(fn).not.toHaveBeenCalled();
  });
});
