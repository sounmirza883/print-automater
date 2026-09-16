import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type pino from "pino";

export interface AgentStatus {
  paired: boolean;
  deviceId: string | null;
  shopId: string | null;
  pairing: boolean;
  lastError: string | null;
  lastHeartbeatAt: string | null;
}

export interface LoopbackServerOptions {
  port: number;
  logger: pino.Logger;
  getStatus: () => AgentStatus;
  pair: (pairingCode: string, backendBaseUrl: string) => Promise<void>;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const STATUS_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Print Automated Agent</title>
<style>
  body { font: 14px system-ui, sans-serif; max-width: 480px; margin: 40px auto; color: #1a1a1a; }
  h1 { font-size: 18px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  input { padding: 8px; font-size: 14px; width: 100%; box-sizing: border-box; margin-bottom: 8px; }
  button { padding: 8px 16px; font-size: 14px; cursor: pointer; }
  .ok { color: #0a7a2f; } .err { color: #b00020; } .muted { color: #666; }
</style>
</head>
<body>
<h1>Print Automated Agent</h1>
<div class="card" id="status">Loading...</div>
<div class="card" id="pairing-form" hidden>
  <p>Enter the 8-character pairing code shown in the Shop app's More tab.</p>
  <input id="code" maxlength="8" placeholder="Pairing code" autocapitalize="characters">
  <button id="pair-btn">Pair this device</button>
  <p id="pair-error" class="err"></p>
</div>
<script>
async function refresh() {
  const res = await fetch("/api/status");
  const s = await res.json();
  const el = document.getElementById("status");
  const form = document.getElementById("pairing-form");
  if (s.paired) {
    el.innerHTML = '<p class="ok">Paired</p><p>Device: ' + s.deviceId + '</p><p>Shop: ' + s.shopId + '</p>' +
      (s.lastHeartbeatAt ? '<p class="muted">Last heartbeat: ' + s.lastHeartbeatAt + '</p>' : '<p class="muted">No heartbeat sent yet.</p>');
    form.hidden = true;
  } else {
    el.innerHTML = s.pairing ? '<p class="muted">Pairing...</p>' : '<p class="muted">Not paired</p>' +
      (s.lastError ? '<p class="err">' + s.lastError + '</p>' : '');
    form.hidden = false;
  }
}
document.getElementById("pair-btn").addEventListener("click", async () => {
  const code = document.getElementById("code").value.trim();
  const errEl = document.getElementById("pair-error");
  errEl.textContent = "";
  try {
    const res = await fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: code }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errEl.textContent = body.message || "Pairing failed.";
    }
  } catch (e) {
    errEl.textContent = "Could not reach the agent process.";
  }
  refresh();
});
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;

/** §9.5's loopback pairing/status UI. Binds to `127.0.0.1` explicitly
 * (never `0.0.0.0` or an omitted host, which defaults to all
 * interfaces) -- this process holds an Ed25519 private key and, once
 * paired, a bearer token; nothing on the shop's LAN should be able to
 * reach it. The Done-when for this is an external-interface connection
 * attempt being refused, not merely "the UI works when I open it
 * locally." */
export class LoopbackServer {
  private readonly server: Server;

  constructor(private readonly options: LoopbackServerOptions) {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        this.options.logger.error({ err }, "loopback server request handler threw");
        if (!res.headersSent) {
          sendJson(res, 500, { message: "Internal error." });
        }
      });
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(STATUS_PAGE);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, this.options.getStatus());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pair") {
      const body = await readJsonBody(req);
      const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode : "";
      const backendBaseUrl = typeof body.backendBaseUrl === "string" ? body.backendBaseUrl : "";
      if (pairingCode.length !== 8) {
        sendJson(res, 422, { message: "Pairing code must be 8 characters." });
        return;
      }
      try {
        await this.options.pair(pairingCode, backendBaseUrl);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Pairing failed.";
        sendJson(res, 502, { message });
      }
      return;
    }

    sendJson(res, 404, { message: "Not found." });
  }

  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.options.port, "127.0.0.1", () => {
        this.options.logger.info(
          { port: this.options.port },
          "loopback server listening on 127.0.0.1",
        );
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
