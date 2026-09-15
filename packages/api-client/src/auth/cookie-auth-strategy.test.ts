import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CookieAuthStrategy } from "./cookie-auth-strategy.js";

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

describe("CookieAuthStrategy", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("never contributes an auth header -- the session travels as a cookie", async () => {
    const strategy = new CookieAuthStrategy({ refreshUrl: "https://example.invalid/refresh" });
    await expect(strategy.getHeaders()).resolves.toEqual({});
  });

  it("requests credentials:'include' so the browser attaches/accepts the cookie", () => {
    const strategy = new CookieAuthStrategy({ refreshUrl: "https://example.invalid/refresh" });
    expect(strategy.getRequestInit()).toEqual({ credentials: "include" });
  });

  it("refresh() POSTs to the configured refresh URL and reports success from the response status", async () => {
    let receivedMethod: string | undefined;
    let receivedUrl: string | undefined;
    const server = await startServer((req, res) => {
      receivedMethod = req.method;
      receivedUrl = req.url;
      res.writeHead(200);
      res.end();
    });
    close = server.close;

    const strategy = new CookieAuthStrategy({ refreshUrl: `${server.baseUrl}/api/auth/refresh` });
    await expect(strategy.refresh()).resolves.toBe(true);
    expect(receivedMethod).toBe("POST");
    expect(receivedUrl).toBe("/api/auth/refresh");
  });

  it("refresh() reports failure when the refresh endpoint responds non-2xx", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    close = server.close;

    const strategy = new CookieAuthStrategy({ refreshUrl: `${server.baseUrl}/api/auth/refresh` });
    await expect(strategy.refresh()).resolves.toBe(false);
  });
});
