import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { Queue } from "bullmq";
import { QUEUE_NAMES, type DocumentProcessingJob } from "@print-automated/backend-shared";

/** 2.6's literal Done-when: "A no-op job enqueued by the API is
 * consumed by the worker." Spawns the actual worker entry point as a
 * genuinely separate OS process -- not a Nest testing module standing
 * in for it -- and adds a job through a plain bullmq Queue client (the
 * same mechanism 2.5's DocumentsService uses), then confirms that
 * separate process is what completes it. Containerizing api+worker
 * under docker compose itself is explicitly 12.6's job (Dockerfiles);
 * this is the meaningful part of the Done-when available before then. */
describe("Worker process consumes document-processing jobs (e2e)", () => {
  let workerProcess: ChildProcess;
  let queue: Queue<DocumentProcessingJob>;
  const workerRoot = path.resolve(__dirname, "..");

  beforeAll(async () => {
    queue = new Queue(QUEUE_NAMES.DOCUMENT_PROCESSING, {
      connection: { host: "localhost", port: 6380 },
    });

    await new Promise<void>((resolve, reject) => {
      // Single command string, not an args array, with shell: true --
      // avoids Node's DEP0190 (unescaped array-arg concatenation) while
      // still resolving pnpm's platform-specific shim.
      workerProcess = spawn("pnpm exec tsx src/main.ts", {
        cwd: workerRoot,
        env: process.env,
        shell: true,
      });

      const timeout = setTimeout(() => reject(new Error("Worker did not start in time")), 20_000);
      workerProcess.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Worker started, listening for jobs")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      workerProcess.on("error", reject);
    });
  }, 25_000);

  afterAll(async () => {
    await queue.close();
    workerProcess.kill();
  });

  it("a job added to the queue is picked up and completed by the separate worker process", async () => {
    const documentId = randomUUID();
    const job = await queue.add(
      QUEUE_NAMES.DOCUMENT_PROCESSING,
      { documentId },
      { jobId: documentId },
    );

    const deadline = Date.now() + 15_000;
    let state = await job.getState();
    while (state !== "completed" && state !== "failed" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      state = await job.getState();
    }

    if (state === "failed") {
      throw new Error(`Job failed: ${job.failedReason}`);
    }
    expect(state).toBe("completed");

    // Re-fetch: the local `job` reference doesn't auto-refresh
    // returnvalue as the worker's own process updates it.
    const finished = await queue.getJob(documentId);
    expect(finished?.returnvalue).toEqual({ documentId });
  }, 20_000);
});
