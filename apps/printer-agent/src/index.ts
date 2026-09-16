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
import { ReconnectBackoff } from "./backend/reconnect-backoff.js";
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
// §90/10.7: on a heartbeat failure, back off past the healthy 30s
// cadence rather than just waiting for the next fixed tick -- up to
// this ceiling for a persistent outage.
const HEARTBEAT_BACKOFF_CEILING_MS = 5 * 60_000;
// Server-side agent JWT TTL is 15m (agent-token.service.ts) -- cache
// for less than that so a call made right at the cache boundary never
// presents a token the server would already consider expired.
const ACCESS_TOKEN_CACHE_MS = 14 * 60_000;
const JOB_POLL_WAIT_SECONDS = 20;
// §90/10.7: same exponential-backoff-with-ceiling shape as the
// heartbeat loop above -- starts at the same 5s pause this constant
// always used, but now grows on a persistent failure instead of
// repeating forever at a fixed interval.
const JOB_LOOP_ERROR_BACKOFF_MS = 5_000;
const JOB_LOOP_BACKOFF_CEILING_MS = 60_000;
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

  // §90/10.7: one tracker per independently-failing loop -- the
  // heartbeat and job-poll loops hit the backend on their own separate
  // schedules and can fail independently (e.g. a job-poll timeout while
  // heartbeats keep succeeding), so each needs its own consecutive-
  // failure count rather than sharing one.
  const heartbeatBackoff = new ReconnectBackoff({
    initialIntervalMs: HEARTBEAT_INTERVAL_MS,
    maxIntervalMs: HEARTBEAT_BACKOFF_CEILING_MS,
  });
  const jobLoopBackoff = new ReconnectBackoff({
    initialIntervalMs: JOB_LOOP_ERROR_BACKOFF_MS,
    maxIntervalMs: JOB_LOOP_BACKOFF_CEILING_MS,
  });

  // §90/10.7's own "reconciles state before resuming": re-running the
  // same startup sweep (9.5/9.10) an outage's first successful call
  // triggers it. It's a cheap, idempotent local SQLite scan (a second,
  // redundant call from the other loop recovering in the same tick
  // just finds nothing left to sweep), so no extra guard is needed
  // against both loops reconnecting on the same tick.
  function onReconnect(source: "heartbeat" | "job-loop"): void {
    const swept = markUnresolvedAsUnknown(ledger, logger);
    logger.info({ source, sweptCount: swept }, "reconnected to backend -- ledger reconciled");
  }

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

  // Returns whether the attempt succeeded -- unpaired is treated as
  // success (nothing to report yet, not a failure to back off from),
  // matching the "just wait quietly" shape the job loop already uses
  // for the same unpaired case.
  async function sendHeartbeat(): Promise<boolean> {
    if (identity === null) {
      return true;
    }
    try {
      const token = await getAccessToken();
      const discovered = await discoverPrinters(logger);
      const printers = toHeartbeatPrinters(discovered, lastReportedCapabilities);
      await backendClient.sendHeartbeat(token, printers);
      lastHeartbeatAt = new Date().toISOString();
      lastError = null;
      tray?.setStatus(`paired (shop ${identity.shopId})`);
      return true;
    } catch (err) {
      lastError = err instanceof BackendError ? err.message : "Heartbeat failed.";
      logger.warn({ err }, "heartbeat failed");
      tray?.setStatus("heartbeat failed");
      return false;
    }
  }

  /** §90/10.7: replaces a plain `setInterval` so a failure can wait
   * longer than the next fixed tick (exponential backoff, capped) while
   * a healthy run always waits the normal HEARTBEAT_INTERVAL_MS. */
  async function heartbeatLoop(): Promise<void> {
    while (!shuttingDown) {
      const ok = await sendHeartbeat();
      if (ok) {
        if (heartbeatBackoff.recordSuccess()) {
          onReconnect("heartbeat");
        }
        await sleep(HEARTBEAT_INTERVAL_MS);
      } else {
        await sleep(heartbeatBackoff.recordFailure());
      }
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
        // Reaching here at all -- whether a job was found or the poll
        // simply came back empty -- means the round-trip to the backend
        // worked, which is exactly the signal a reconnect happened.
        if (jobLoopBackoff.recordSuccess()) {
          onReconnect("job-loop");
        }
        if (result.outcome === "printed") {
          logger.info(
            { jobId: result.jobId, osJobId: result.osJobId },
            "print job submitted to the spooler",
          );
        }
      } catch (err) {
        logger.error({ err }, "job processing loop error");
        await sleep(jobLoopBackoff.recordFailure());
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
  } else {
    tray?.setStatus("not paired");
  }

  // heartbeatLoop() itself sends one immediately as its first
  // iteration (no separate startup-only call needed anymore, unlike
  // the old setInterval, which only fired its first tick after a full
  // HEARTBEAT_INTERVAL_MS) -- a standalone call here would just race
  // that same first iteration and double up the very first heartbeat.
  void heartbeatLoop();
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
