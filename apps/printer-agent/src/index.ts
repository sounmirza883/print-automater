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
import { BackendClient, BackendError } from "./backend/backend-client.js";
import { createTray } from "./tray/tray.js";
import { LoopbackServer, type AgentStatus } from "./server/loopback-server.js";
import {
  discoverPrinters,
  toHeartbeatPrinters,
  type DiscoveredPrinter,
} from "./printers/discovery.js";

const LOOPBACK_PORT = 7171;
const HEARTBEAT_INTERVAL_MS = 30_000;
// Server-side agent JWT TTL is 15m (agent-token.service.ts) -- cache
// for less than that so a call made right at the cache boundary never
// presents a token the server would already consider expired.
const ACCESS_TOKEN_CACHE_MS = 14 * 60_000;

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
  const unresolved = ledger.getUnresolved();
  if (unresolved.length > 0) {
    logger.warn(
      { count: unresolved.length },
      "unresolved job ledger rows from a previous run -- see 9.11's monitor / 11.6's sweeper",
    );
  }

  const backendClient = new BackendClient(env.API_BASE_URL, logger);

  let identity: AgentIdentity | null = loadIdentity();
  let pairing = false;
  let lastError: string | null = null;
  let lastHeartbeatAt: string | null = null;
  let cachedAccessToken: { token: string; expiresAt: number } | null = null;
  const lastReportedCapabilities = new Map<string, DiscoveredPrinter["capabilities"]>();

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

  async function getAccessToken(): Promise<string> {
    if (identity === null) {
      throw new Error("Not paired.");
    }
    if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
      return cachedAccessToken.token;
    }
    const nonce = await backendClient.fetchChallenge(identity.deviceId);
    const signature = signChallenge(identity, nonce);
    const token = await backendClient.authenticate(identity.deviceId, signature);
    cachedAccessToken = { token, expiresAt: Date.now() + ACCESS_TOKEN_CACHE_MS };
    return token;
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

  const loopbackServer = new LoopbackServer({
    port: LOOPBACK_PORT,
    logger,
    getStatus: currentStatus,
    pair,
  });
  await loopbackServer.listen();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
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
