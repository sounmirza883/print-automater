import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryTokenStorage } from "@print-automated/api-client";
import { createMobileApiClient } from "./api-client.js";

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

describe("createMobileApiClient", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("logs in, then attaches the stored access token as a Bearer header on the next call", async () => {
    let sawOnLogin: string | undefined;
    let sawOnDocumentGet: string | undefined;
    const server = await startServer((req, res) => {
      if (req.url === "/v1/auth/login") {
        sawOnLogin = req.headers.authorization;
        sendJson(res, 200, {
          user: { id: "u1", name: "Priya", email: "priya@example.com", role: "SHOP_COUNTER" },
          accessToken: "access-1",
          refreshToken: "refresh-1",
        });
        return;
      }
      if (req.url === "/v1/documents/doc-1") {
        sawOnDocumentGet = req.headers.authorization;
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

    const storage = new InMemoryTokenStorage();
    const client = createMobileApiClient({ baseUrl: server.baseUrl, storage });

    const loginResult = await client.auth.login({
      email: "priya@example.com",
      password: "password123",
    });
    // login itself carries no stale credential -- there isn't one yet.
    expect(sawOnLogin).toBeUndefined();

    // The factory doesn't persist tokens on the caller's behalf --
    // that's the app screen's job, same as it is for web (Phase 3.3/3.4
    // own that flow); this proves storage really drives getHeaders().
    await storage.setTokens({
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
    });

    await client.documents.getStatus("doc-1");
    expect(sawOnDocumentGet).toBe("Bearer access-1");
  });

  it("on a 401, refreshes via the real /v1/auth/refresh route and retries with the new token", async () => {
    let refreshHits = 0;
    let documentHits = 0;
    const server = await startServer((req, res) => {
      if (req.url === "/v1/auth/refresh") {
        refreshHits += 1;
        sendJson(res, 200, { accessToken: "access-2", refreshToken: "refresh-2" });
        return;
      }
      if (req.url === "/v1/documents/doc-1") {
        documentHits += 1;
        if (req.headers.authorization === "Bearer access-2") {
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
        sendJson(res, 401, {
          error_code: "UNAUTHENTICATED",
          message: "Session expired.",
          retryable: true,
          request_id: "req-1",
        });
        return;
      }
      sendJson(res, 404, {});
    });
    close = server.close;

    const storage = new InMemoryTokenStorage();
    await storage.setTokens({ accessToken: "stale", refreshToken: "refresh-1" });
    const client = createMobileApiClient({ baseUrl: server.baseUrl, storage });

    const status = await client.documents.getStatus("doc-1");

    expect(status.status).toBe("READY");
    expect(refreshHits).toBe(1);
    expect(documentHits).toBe(2);
    await expect(storage.getAccessToken()).resolves.toBe("access-2");
  });
});
