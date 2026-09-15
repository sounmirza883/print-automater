import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { Queue } from "bullmq";
import { S3Client } from "@aws-sdk/client-s3";
import { DocumentStatus, UserRole } from "@prisma/client";
import { workerEnvSchema, loadEnv } from "@print-automated/config";
import {
  QUEUE_NAMES,
  type DocumentProcessingJob,
  PrismaService,
  StorageService,
} from "@print-automated/backend-shared";

const execFileAsync = promisify(execFile);

/** child.kill() only signals the immediate process -- with shell: true
 * on Windows that's a cmd.exe wrapper, not the pnpm -> tsx -> node chain
 * it spawns, so the real worker process survives, keeps its BullMQ
 * Worker attached to Redis, and races the NEXT test run for jobs
 * (empirically caused real flakiness: an orphaned worker from a prior
 * run sometimes won the race for a job before the freshly spawned one
 * could). taskkill /T kills the whole tree; POSIX's plain kill is fine
 * since there's no equivalent wrapper-process problem there. */
async function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
  } else {
    child.kill("SIGKILL");
  }
}

/** 2.6's Done-when ("a no-op job enqueued by the API is consumed by the
 * worker") plus 2.7's real pipeline together: spawns the actual worker
 * entry point as a genuinely separate OS process -- not a Nest testing
 * module standing in for it -- seeds a real PROCESSING document row and
 * quarantine object exactly as 2.5's DocumentsService.confirmUpload
 * would, adds the job through a plain bullmq Queue client, and confirms
 * that separate process both completes the job AND does the real work
 * (READY, correct page count). Containerizing api+worker under docker
 * compose itself is explicitly 12.6's job (Dockerfiles); this is the
 * meaningful part of the Done-when available before then. */
describe("Worker process consumes document-processing jobs (e2e)", () => {
  let workerProcess: ChildProcess;
  let queue: Queue<DocumentProcessingJob>;
  let prisma: PrismaService;
  let storage: StorageService;
  let ownerId: string;
  const workerRoot = path.resolve(__dirname, "..");
  const validPdf = readFileSync(path.join(workerRoot, "test/fixtures/valid.pdf"));

  beforeAll(async () => {
    const env = loadEnv(workerEnvSchema, process.env);
    const s3 = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
    storage = new StorageService(s3, env.S3_BUCKET);
    prisma = new PrismaService();
    await prisma.$connect();

    const owner = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Worker Cross-Process E2E Owner",
        email: `worker-e2e-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    ownerId = owner.id;

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
  }, 30_000);

  afterAll(async () => {
    await queue.close();
    await killProcessTree(workerProcess);
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("a real job, seeded exactly as 2.5's confirmUpload leaves it, is picked up and fully processed to READY by the separate worker process", async () => {
    const documentId = randomUUID();
    const quarantineKey = storage.quarantineKey(documentId);

    await prisma.document.create({
      data: {
        id: documentId,
        ownerUserId: ownerId,
        storageKey: quarantineKey,
        filename: "cross-process-fixture.pdf",
        mimeType: "application/pdf",
        sizeBytes: validPdf.length,
        status: DocumentStatus.PROCESSING,
      },
    });
    await storage.putObjectBuffer(quarantineKey, validPdf, "application/pdf");

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

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.status).toBe(DocumentStatus.READY);
    expect(doc.pageCount).toBe(1);
    await expect(storage.objectExists(quarantineKey)).resolves.toBe(false);

    await prisma.document.delete({ where: { id: documentId } });
    await storage.deleteObject(storage.documentKey(documentId)).catch(() => undefined);
  }, 20_000);
});
