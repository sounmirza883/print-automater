import "dotenv/config";
import { agentEnvSchema, loadEnvOrExit } from "@print-automated/config";
import { ensureConfigDirs } from "./config/paths.js";
import { createLogger } from "./logging/logger.js";
import {
  loadIdentity,
  saveIdentity,
  generateKeyMaterial,
  signChallenge,
  type AgentIdentity,
} from "./config/identity-store.js";
import { JobLedger } from "./ledger/ledger.js";
import { markUnresolvedAsUnknown } from "./ledger/startup-sweep.js";
import { BackendClient, BackendError } from "./backend/backend-client.js";
import { createTray } from "./tray/tray.js";
import { LoopbackServer, type AgentStatus } from "./server/loopback-server.js";
import {
  discoverPrinters,
  toHeartbeatPrinters,
  type DiscoveredPrinter,
} from "./printers/discovery.js";
import { SumatraPrinterDriver } from "./printers/driver/sumatra-driver.js";
import { processNextJob } from "./printers/job-processor.js";

const LOOPBACK_PORT = 7171;
const HEARTBEAT_INTERVAL_MS = 30_000;
// Server-side agent JWT TTL is 15m (agent-token.service.ts) -- cache
// for less than that so a call made right at the cache boundary never
// presents a token the server would already consider expired.
const ACCESS_TOKEN_CACHE_MS = 14 * 60_000;
const JOB_POLL_WAIT_SECONDS = 20;
// Deliberately simple: a fixed pause after any job-loop error, not the
// exponential-backoff-with-ceiling reconnection policy 10.7 owns --
// this just keeps a persistent failure (backend down, bad credentials)
// from spinning the loop at full speed instead of actually backing off.
const JOB_LOOP_ERROR_BACKOFF_MS = 5_000;
const NOT_PAIRED_POLL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const env = loadEnvOrExit(agentEnvSchema);
  ensureConfigDirs();
  const logger = createLogger();
  logger.info({ apiBaseUrl: env.API_BASE_URL }, "printer agent starting");

  // `systray`'s own readline handler (node_modules/systray/src/index.ts)
  // calls `JSON.parse` on every line the native tray binary writes to
  // stdout/stderr with no try/catch of its own -- a single non-JSON
  // line (verified in practice: a native "load icon image" failure
  // message) throws *inside an EventEmitter callback*, which Node
  // surfaces as an uncaught exception that would otherwise kill this
  // entire process. A background agent's job (claim, print, report)
  // must never depend on an optional tray icon staying alive, so this
  // is the only reliable backstop against a bug inside a third-party
  // native-binary wrapper: swallow exceptions that originate from
  // `systray` specifically, and preserve Node's normal fatal behavior
  // for anything else.
  process.on("uncaughtException", (err) => {
    if (err.stack?.includes("systray")) {
      logger.warn({ err }, "systray threw internally; tray disabled for the rest of this run");
      return;
    }
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  const ledger = new JobLedger();
  // §9.10's own Done-when: a row this process didn't resolve itself
  // (a prior run claimed it, then crashed or was killed before ever
  // learning the outcome) is marked UNKNOWN here, on this process's
  // very first tick -- never silently resubmitted.
  markUnresolvedAsUnknown(ledger, logger);

  const backendClient = new BackendClient(env.API_BASE_URL, logger);
  const driver = new SumatraPrinterDriver(env.SUMATRA_PATH, logger);

  let identity: AgentIdentity | null = loadIdentity();
  let pairing = false;
  let lastError: string | null = null;
  let lastHeartbeatAt: string | null = null;
  let cachedAccessToken: { token: string; expiresAt: number } | null = null;
  const lastReportedCapabilities = new Map<string, DiscoveredPrinter["capabilities"]>();
  let shuttingDown = false;

  const tray = createTray(logger);

  function currentStatus(): AgentStatus {
    return {
      paired: identity !== null,
      deviceId: identity?.deviceId ?? null,
      shopId: identity?.shopId ?? null,
      pairing,
      lastError,
      lastHeartbeatAt,
    };
  }

  // §9.10's own real find: the heartbeat loop and the job-processing
  // loop both call getAccessToken() independently, and at startup both
  // fire within the same tick -- with no de-duplication, two
  // concurrent callers each fetch their own challenge nonce from
  // agent-challenge.service.ts, which simply overwrites whatever nonce
  // was already pending for this deviceId (`redis.set`, not a
  // check-and-set). The first caller's signature, computed over the
  // nonce that just got clobbered by the second, then fails
  // verification server-side with a genuine, reproducible
  // INVALID_SIGNATURE -- caught by actually running both loops
  // together against the real backend, not something either loop's
  // own isolated testing would ever have surfaced. Single-flighting
  // the whole challenge/authenticate round-trip (mirroring
  // packages/api-client's own refresh-on-401 dedup, 3.1) means a
  // second concurrent caller awaits the SAME in-flight request instead
  // of starting a competing one.
  let inFlightAuth: Promise<string> | null = null;

  async function getAccessToken(): Promise<string> {
    if (identity === null) {
      throw new Error("Not paired.");
    }
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
      return cachedAccessToken.token;
    }
    if (inFlightAuth) {
      return inFlightAuth;
    }
    const currentIdentity = identity;
    inFlightAuth = (async () => {
      const nonce = await backendClient.fetchChallenge(currentIdentity.deviceId);
      const signature = signChallenge(currentIdentity, nonce);
      const token = await backendClient.authenticate(currentIdentity.deviceId, signature);
      cachedAccessToken = { token, expiresAt: Date.now() + ACCESS_TOKEN_CACHE_MS };
      return token;
    })();
    try {
      return await inFlightAuth;
    } finally {
      inFlightAuth = null;
    }
  }

  async function sendHeartbeat(): Promise<void> {
    if (identity === null) {
      return;
    }
    try {
      const token = await getAccessToken();
      const discovered = await discoverPrinters(logger);
      const printers = toHeartbeatPrinters(discovered, lastReportedCapabilities);
      await backendClient.sendHeartbeat(token, printers);
      lastHeartbeatAt = new Date().toISOString();
      lastError = null;
      tray?.setStatus(`paired (shop ${identity.shopId})`);
    } catch (err) {
      lastError = err instanceof BackendError ? err.message : "Heartbeat failed.";
      logger.warn({ err }, "heartbeat failed");
      tray?.setStatus("heartbeat failed");
    }
  }

  /** §9.9/9.10's continuous claim-and-print loop -- one long-lived
   * call, not re-entered per tick: `processNextJob` itself already
   * blocks for up to `JOB_POLL_WAIT_SECONDS` per iteration (9.7's own
   * long-poll), so this is the loop's entire pacing. Waits quietly
   * when unpaired rather than erroring, since `identity` becoming
   * non-null is exactly what `pair()` does to the same closed-over
   * variable this function reads on its next iteration. */
  async function runJobLoop(): Promise<void> {
    while (!shuttingDown) {
      if (identity === null) {
        await sleep(NOT_PAIRED_POLL_MS);
        continue;
      }
      try {
        const token = await getAccessToken();
        const result = await processNextJob(backendClient, token, {
          baseUrl: env.API_BASE_URL,
          driver,
          ledger,
          logger,
          waitSeconds: JOB_POLL_WAIT_SECONDS,
        });
        if (result.outcome === "printed") {
          logger.info(
            { jobId: result.jobId, osJobId: result.osJobId },
            "print job submitted to the spooler",
          );
        }
      } catch (err) {
        logger.error({ err }, "job processing loop error");
        await sleep(JOB_LOOP_ERROR_BACKOFF_MS);
      }
    }
  }

  async function pair(pairingCode: string, backendBaseUrlOverride: string): Promise<void> {
    if (identity !== null) {
      throw new Error("This device is already paired.");
    }
    pairing = true;
    lastError = null;
    tray?.setStatus("pairing...");
    try {
      const client = backendBaseUrlOverride
        ? new BackendClient(backendBaseUrlOverride, logger)
        : backendClient;
      const keyMaterial = generateKeyMaterial();
      const { shopId } = await client.registerAgent(
        pairingCode,
        keyMaterial.deviceId,
        keyMaterial.publicKeyJwk,
      );
      const newIdentity: AgentIdentity = { ...keyMaterial, shopId };
      saveIdentity(newIdentity);
      identity = newIdentity;
      logger.info({ deviceId: identity.deviceId, shopId }, "paired successfully");
      tray?.setStatus(`paired (shop ${shopId})`);
      void sendHeartbeat();
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Pairing failed.";
      tray?.setStatus("pairing failed");
      logger.error({ err }, "pairing failed");
      throw err instanceof Error ? err : new Error("Pairing failed.");
    } finally {
      pairing = false;
    }
  }

  if (identity !== null) {
    logger.info(
      { deviceId: identity.deviceId, shopId: identity.shopId },
      "loaded existing identity from disk",
    );
    tray?.setStatus(`paired (shop ${identity.shopId})`);
    void sendHeartbeat();
  } else {
    tray?.setStatus("not paired");
  }

  setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS).unref();
  void runJobLoop();

  const loopbackServer = new LoopbackServer({
    port: LOOPBACK_PORT,
    logger,
    getStatus: currentStatus,
    pair,
  });
  await loopbackServer.listen();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    shuttingDown = true;
    tray?.close();
    ledger.close();
    loopbackServer
      .close()
      .catch((err: unknown) => logger.warn({ err }, "error closing loopback server"))
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("printer agent failed to start", err);
  process.exit(1);
});
