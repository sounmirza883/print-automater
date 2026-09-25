import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiClient } from "./client.js";
import {
  BearerTokenAuthStrategy,
  InMemoryTokenStorage,
} from "./auth/bearer-token-auth-strategy.js";

/** Phase 23 resources hit the exact routes services/api exposes. */
function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server: Server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe("Phase 23 ApiClient resources", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function withClient(
    run: (client: ApiClient, seen: Array<{ method?: string; url?: string }>) => Promise<void>,
  ): Promise<void> {
    const seen: Array<{ method?: string; url?: string }> = [];
    const server = await startServer((req, res) => {
      seen.push({ method: req.method, url: req.url });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }));
    });
    close = server.close;
    const strategy = new BearerTokenAuthStrategy({
      baseUrl: server.baseUrl,
      storage: new InMemoryTokenStorage(),
    });
    await run(new ApiClient({ baseUrl: server.baseUrl, authStrategy: strategy }), seen);
  }

  it("dashboard routes (23.2)", async () => {
    await withClient(async (client, seen) => {
      await client.dashboard.owner("s1", { from: "2026-01-01T00:00:00Z" });
      await client.dashboard.operator("s1", 10);
      await client.dashboard.printers("s1");
      await client.dashboard.admin();
      expect(seen).toEqual([
        { method: "GET", url: "/v1/shop/dashboard/owner?shopId=s1&from=2026-01-01T00%3A00%3A00Z" },
        { method: "GET", url: "/v1/shop/dashboard/operator?shopId=s1&limit=10" },
        { method: "GET", url: "/v1/shop/dashboard/printers?shopId=s1" },
        { method: "GET", url: "/v1/admin/dashboard" },
      ]);
    });
  });
});
