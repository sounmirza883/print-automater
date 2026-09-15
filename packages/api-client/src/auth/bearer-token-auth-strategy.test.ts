import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BearerTokenAuthStrategy, InMemoryTokenStorage } from "./bearer-token-auth-strategy.js";

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

describe("BearerTokenAuthStrategy", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("attaches Authorization: Bearer <access token> once one is stored, and {} before then", async () => {
    const storage = new InMemoryTokenStorage();
    const strategy = new BearerTokenAuthStrategy({ baseUrl: "https://example.invalid", storage });

    await expect(strategy.getHeaders()).resolves.toEqual({});

    await storage.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    await expect(strategy.getHeaders()).resolves.toEqual({ Authorization: "Bearer access-1" });
  });

  it("refresh() POSTs the stored refresh token and persists the new pair on success", async () => {
    let receivedBody = "";
    const server = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString();
        expect(req.url).toBe("/v1/auth/refresh");
        sendJson(res, 200, { accessToken: "access-2", refreshToken: "refresh-2" });
      });
    });
    close = server.close;

    const storage = new InMemoryTokenStorage();
    await storage.setTokens({ accessToken: "stale", refreshToken: "refresh-1" });
    const strategy = new BearerTokenAuthStrategy({ baseUrl: server.baseUrl, storage });

    await expect(strategy.refresh()).resolves.toBe(true);
    expect(JSON.parse(receivedBody)).toEqual({ refreshToken: "refresh-1" });
    await expect(storage.getAccessToken()).resolves.toBe("access-2");
    await expect(storage.getRefreshToken()).resolves.toBe("refresh-2");
  });

  it("refresh() clears storage and reports failure when the server rejects the refresh token", async () => {
    const server = await startServer((_req, res) => {
      sendJson(res, 401, {
        error_code: "REFRESH_TOKEN_REUSE_DETECTED",
        message: "Session revoked.",
        retryable: false,
        request_id: "req-1",
      });
    });
    close = server.close;

    const storage = new InMemoryTokenStorage();
    await storage.setTokens({ accessToken: "stale", refreshToken: "compromised" });
    const strategy = new BearerTokenAuthStrategy({ baseUrl: server.baseUrl, storage });

    await expect(strategy.refresh()).resolves.toBe(false);
    await expect(storage.getAccessToken()).resolves.toBeNull();
    await expect(storage.getRefreshToken()).resolves.toBeNull();
  });

  it("refresh() reports failure without a network call when there is no refresh token stored", async () => {
    const storage = new InMemoryTokenStorage();
    const fetchImpl = jest.fn();
    const strategy = new BearerTokenAuthStrategy({
      baseUrl: "https://example.invalid",
      storage,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(strategy.refresh()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
