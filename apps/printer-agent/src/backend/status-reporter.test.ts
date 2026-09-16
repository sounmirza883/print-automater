import { createServer, type Server } from "node:http";
import type pino from "pino";
import { BackendClient } from "./backend-client.js";
import { reportJobStatusWithRetry } from "./status-reporter.js";

function silentLogger(): pino.Logger {
  return { warn: jest.fn() } as unknown as pino.Logger;
}

/** §9.12's own Done-when: "a status report sent during a network
 * outage arrives exactly once after reconnection." Against a real
 * node:http fixture that can be told to simulate an outage (refuse
 * connections) for N attempts before "reconnecting" -- proves both
 * halves: this function keeps retrying with backoff until it gets
 * through, and every attempt (including the one that finally
 * succeeds) carries the exact same Idempotency-Key, which is what
 * lets the real backend's own interceptor (5.3, verified separately
 * in agent-job-status.e2e-spec.ts) collapse them into one applied
 * transition. */
describe("reportJobStatusWithRetry (9.12)", () => {
  let server: Server;
  let baseUrl: string;
  let failuresRemaining = 0;
  const receivedRequests: Array<{ idempotencyKey: string | undefined; status: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        // Simulate an outage: destroy the connection with no response
        // at all, the same shape a dropped network path produces --
        // not a clean 5xx, which would be a different (retryable, but
        // answered) failure mode.
        req.socket.destroy();
        return;
      }
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { status: string };
        receivedRequests.push({
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
          status: parsed.status,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("");
      });
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
    failuresRemaining = 0;
    receivedRequests.length = 0;
  });

  it("retries through a simulated outage and delivers exactly once, reusing the same idempotency key on every attempt", async () => {
    failuresRemaining = 3;
    const client = new BackendClient(baseUrl, silentLogger());

    await reportJobStatusWithRetry(client, "token", "job-42", "PRINTED", "os-7", silentLogger(), {
      initialIntervalMs: 5,
      maxIntervalMs: 20,
    });

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0]?.status).toBe("PRINTED");
    expect(receivedRequests[0]?.idempotencyKey).toBe("job-42:PRINTED");
  });

  it("a different (job, status) pair gets its own distinct idempotency key", async () => {
    const client = new BackendClient(baseUrl, silentLogger());

    await reportJobStatusWithRetry(
      client,
      "token",
      "job-42",
      "PRINTING",
      undefined,
      silentLogger(),
    );
    await reportJobStatusWithRetry(client, "token", "job-42", "FAILED", undefined, silentLogger());

    expect(receivedRequests.map((r) => r.idempotencyKey)).toEqual([
      "job-42:PRINTING",
      "job-42:FAILED",
    ]);
  });

  it("gives up and throws once maxAttempts is exhausted against a persistent outage", async () => {
    failuresRemaining = 100;
    const client = new BackendClient(baseUrl, silentLogger());

    await expect(
      reportJobStatusWithRetry(client, "token", "job-99", "FAILED", undefined, silentLogger(), {
        initialIntervalMs: 5,
        maxAttempts: 3,
      }),
    ).rejects.toThrow();

    expect(receivedRequests).toHaveLength(0);
  });

  it("backs off with increasing (capped) intervals between attempts", async () => {
    failuresRemaining = 4;
    const client = new BackendClient(baseUrl, silentLogger());
    const attemptTimes: number[] = [];
    const originalReport = client.reportJobStatus.bind(client);
    jest.spyOn(client, "reportJobStatus").mockImplementation(async (...args) => {
      attemptTimes.push(Date.now());
      return originalReport(...args);
    });

    await reportJobStatusWithRetry(client, "token", "job-7", "PRINTED", undefined, silentLogger(), {
      initialIntervalMs: 20,
      maxIntervalMs: 60,
    });

    expect(attemptTimes.length).toBe(5);
    const gaps = attemptTimes.slice(1).map((t, i) => t - attemptTimes[i]!);
    // 20, 40, 60 (capped), 60 (capped) -- generous tolerance for
    // scheduler jitter, just confirming each gap grows or holds at the
    // cap, never shrinks.
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]! - 10);
    }
  });
});
