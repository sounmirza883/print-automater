import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createWebApiClient } from "./api-client.js";

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("createWebApiClient", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("logs in against the real /v1/auth/login route with no stale credential attached", async () => {
    let seenAuthorization: string | undefined;
    const server = await startServer((req, res) => {
      seenAuthorization = req.headers.authorization;
      sendJson(res, 200, {
        user: { id: "u1", name: "Ann", email: "ann@example.com", role: "CUSTOMER" },
        accessToken: "a",
        refreshToken: "r",
      });
    });
    close = server.close;

    const client = createWebApiClient({
      baseUrl: server.baseUrl,
      refreshUrl: `${server.baseUrl}/api/auth/refresh`,
    });
    const result = await client.auth.login({ email: "ann@example.com", password: "password123" });

    expect(result.user.email).toBe("ann@example.com");
    expect(seenAuthorization).toBeUndefined();
  });

  it("on a 401, refreshes against the app's own configured refreshUrl and retries once", async () => {
    let refreshHits = 0;
    let documentHits = 0;
    const server = await startServer((req, res) => {
      if (req.url === "/api/auth/refresh") {
        refreshHits += 1;
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.url === "/v1/documents/doc-1") {
        documentHits += 1;
        if (documentHits === 1) {
          sendJson(res, 401, {
            error_code: "UNAUTHENTICATED",
            message: "Session expired.",
            retryable: true,
            request_id: "req-1",
          });
          return;
        }
        sendJson(res, 200, {
          id: "doc-1",
          filename: "a.pdf",
          status: "READY",
          pageCount: 1,
          rejectionReason: null,
          createdAt: "2026-01-01",
        });
        return;
      }
      sendJson(res, 404, {});
    });
    close = server.close;

    const client = createWebApiClient({
      baseUrl: server.baseUrl,
      refreshUrl: `${server.baseUrl}/api/auth/refresh`,
    });
    const status = await client.documents.getStatus("doc-1");

    expect(status.status).toBe("READY");
    expect(refreshHits).toBe(1);
    expect(documentHits).toBe(2);
  });
});
