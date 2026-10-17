import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiClient } from "./client.js";
import {
  BearerTokenAuthStrategy,
  InMemoryTokenStorage,
} from "./auth/bearer-token-auth-strategy.js";

interface Seen {
  method?: string;
  url?: string;
  body: unknown;
}

/** Step 3 contract: the calls the console makes once orders and printers belong to a branch.
 * `branchId` narrows a list to one branch (a branch-bound person is always limited to their own,
 * by the server); a pairing code and a PC move name the branch. */
describe("branch-scoped client calls", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function withClient(
    reply: unknown,
    run: (client: ApiClient, seen: Seen[]) => Promise<void>,
  ): Promise<void> {
    const seen: Seen[] = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const strategy = new BearerTokenAuthStrategy({ baseUrl, storage: new InMemoryTokenStorage() });
    await run(new ApiClient({ baseUrl, authStrategy: strategy }), seen);
  }

  const page = { items: [], total: 0, limit: 50, offset: 0 };

  it("narrows the orders list, page and search to a branch", async () => {
    await withClient(page, async (client, seen) => {
      await client.shopOrders.list("s1", "b1");
      expect(seen[0]!.url).toBe("/v1/shop/orders?shopId=s1&branchId=b1");

      await client.shopOrders.listPage("s1", { group: "ready", branchId: "b1" });
      expect(seen[1]!.url).toContain("branchId=b1");
      expect(seen[1]!.url).toContain("group=ready");

      await client.shopOrders.search("s1", { q: "abc", branchId: "b1" });
      expect(seen[2]!.url).toContain("branchId=b1");
      expect(seen[2]!.url).toContain("q=abc");
    });
  });

  it("leaves the branch off when none is chosen (all branches)", async () => {
    await withClient(page, async (client, seen) => {
      await client.shopOrders.list("s1");
      expect(seen[0]!.url).toBe("/v1/shop/orders?shopId=s1");
      await client.printers.list("s1");
      expect(seen[1]!.url).toBe("/v1/shop/printers?shopId=s1");
    });
  });

  it("narrows the printers list and page to a branch", async () => {
    await withClient(page, async (client, seen) => {
      await client.printers.list("s1", "b2");
      expect(seen[0]!.url).toBe("/v1/shop/printers?shopId=s1&branchId=b2");
      await client.printers.listPage("s1", { branchId: "b2", q: "hp" });
      expect(seen[1]!.url).toContain("branchId=b2");
      expect(seen[1]!.url).toContain("q=hp");
    });
  });

  it("asks for a pairing code for a branch", async () => {
    await withClient(
      { code: "ABCD1234", expiresAt: "2026-10-18T10:00:00.000Z" },
      async (client, seen) => {
        await client.printers.issuePairingCode("s1", "b2");
        expect(seen[0]).toMatchObject({
          method: "POST",
          url: "/v1/shop/agents/pairing-code",
          body: { shopId: "s1", branchId: "b2" },
        });

        await client.printers.issuePairingCode("s1");
        expect(seen[1]!.body).toEqual({ shopId: "s1" });
      },
    );
  });

  it("moves a printer's PC, with its printers, to another branch", async () => {
    await withClient([], async (client, seen) => {
      await client.printers.moveBranch("p1", "b2");
      expect(seen[0]).toMatchObject({
        method: "PUT",
        url: "/v1/shop/printers/p1/branch",
        body: { branchId: "b2" },
      });
    });
  });
});
