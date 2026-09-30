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

/** Fix wave 1: admin-only onboarding -- a business is created together with its owner,
 * and the owner's activation code can be re-issued. */
describe("AdminResource business onboarding (fix wave 1)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function withClient(
    reply: (req: IncomingMessage) => { status: number; body: unknown },
    run: (client: ApiClient, seen: Seen[]) => Promise<void>,
  ): Promise<void> {
    const seen: Seen[] = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
        const { status, body } = reply(req);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const strategy = new BearerTokenAuthStrategy({ baseUrl, storage: new InMemoryTokenStorage() });
    await run(new ApiClient({ baseUrl, authStrategy: strategy }), seen);
  }

  it("createBusiness sends the owner with the business and returns the created owner", async () => {
    const owner = { id: "u1", name: "Ayesha", email: "ayesha@example.com" };
    await withClient(
      () => ({
        status: 201,
        body: { id: "b1", name: "Corner Copies", address: "1", status: "CLOSED", owner },
      }),
      async (client, seen) => {
        const created = await client.admin.createBusiness({
          name: "Corner Copies",
          address: "1",
          owner: { name: "Ayesha", email: "ayesha@example.com" },
        });
        expect(created.owner).toEqual(owner);
        expect(seen).toEqual([
          {
            method: "POST",
            url: "/v1/admin/businesses",
            body: {
              name: "Corner Copies",
              address: "1",
              owner: { name: "Ayesha", email: "ayesha@example.com" },
            },
          },
        ]);
      },
    );
  });

  it("reissueOwnerInvite posts to the business's owner-invite route", async () => {
    await withClient(
      () => ({ status: 202, body: { result: "PROCESSED" } }),
      async (client, seen) => {
        await expect(client.admin.reissueOwnerInvite("b1")).resolves.toEqual({
          result: "PROCESSED",
        });
        expect(seen.map(({ method, url }) => ({ method, url }))).toEqual([
          { method: "POST", url: "/v1/admin/businesses/b1/owner-invite" },
        ]);
      },
    );
  });
});
