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

/** Per-person access: the request the Staff page's Edit panel makes. */
describe("ShopStaffResource.updateAccess", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function withClient(
    reply: () => { status: number; body: unknown },
    run: (client: ApiClient, seen: Seen[]) => Promise<void>,
  ): Promise<void> {
    const seen: Seen[] = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
        const { status, body } = reply();
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const strategy = new BearerTokenAuthStrategy({ baseUrl, storage: new InMemoryTokenStorage() });
    await run(new ApiClient({ baseUrl, authStrategy: strategy }), seen);
  }

  it("patches the member with the full permission list", async () => {
    await withClient(
      () => ({
        status: 200,
        body: {
          id: "m1",
          shopId: "s1",
          userId: "u1",
          role: "SHOP_COUNTER",
          status: "ACTIVE",
          permissions: ["VIEW_ORDERS"],
        },
      }),
      async (client, seen) => {
        const result = await client.shopStaff.updateAccess("m1", ["VIEW_ORDERS"]);
        expect(seen[0]).toMatchObject({
          method: "PATCH",
          url: "/v1/shop/staff/m1",
          body: { permissions: ["VIEW_ORDERS"] },
        });
        expect(result.permissions).toEqual(["VIEW_ORDERS"]);
      },
    );
  });
});
