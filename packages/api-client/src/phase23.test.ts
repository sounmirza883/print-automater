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
  it("report routes (23.5)", async () => {
    await withClient(async (client, seen) => {
      await client.reports.orders("s1", { groupBy: "week" });
      await client.reports.revenue("s1");
      await client.reports.printingVolume("s1");
      await client.reports.printers("s1");
      await client.reports.operatorWorkload("s1");
      await client.reports.paperConsumption("s1");
      await client.reports.supplierPurchases("s1", { from: "2026-01-01T00:00:00Z" });
      expect(seen.map((r) => r.url)).toEqual([
        "/v1/shop/reports/orders?shopId=s1&groupBy=week",
        "/v1/shop/reports/revenue?shopId=s1",
        "/v1/shop/reports/printing-volume?shopId=s1",
        "/v1/shop/reports/printers?shopId=s1",
        "/v1/shop/reports/operator-workload?shopId=s1",
        "/v1/shop/reports/paper-consumption?shopId=s1",
        "/v1/shop/reports/supplier-purchases?shopId=s1&from=2026-01-01T00%3A00%3A00Z",
      ]);
      expect(client.reports.csvPath("revenue", "s1", { groupBy: "month" })).toBe(
        "/v1/shop/reports/revenue?shopId=s1&format=csv&groupBy=month",
      );
    });
  });

  it("paginated list routes (23.6)", async () => {
    await withClient(async (client, seen) => {
      await client.shopOrders.listPage("s1", { group: "completed", limit: 20, offset: 40 });
      await client.printers.listPage("s1", { q: "epson", status: "ONLINE" });
      await client.shopStaff.list("s1", { role: "OPERATOR" });
      await client.shopOrders.search("s1", { q: "ali", paymentStatus: "PAID", limit: 10 });
      expect(seen.map((r) => r.url)).toEqual([
        "/v1/shop/orders?shopId=s1&limit=20&offset=40&group=completed",
        "/v1/shop/printers?shopId=s1&q=epson&status=ONLINE&limit=50",
        "/v1/shop/staff?shopId=s1&role=OPERATOR",
        "/v1/shop/orders/search?shopId=s1&q=ali&paymentStatus=PAID&limit=10",
      ]);
    });
  });
});
