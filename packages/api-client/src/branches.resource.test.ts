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

const branch = {
  id: "b1",
  shopId: "s1",
  name: "Gulberg",
  city: "Lahore",
  address: "5 Side Street",
  phone: null,
  isOpen: true,
  openingHours: null,
  archivedAt: null,
  createdAt: "2026-10-17T10:00:00.000Z",
  staffCount: 0,
  managers: [],
};

/** The requests the Branches page and the Staff page's branch pickers make. */
describe("BranchesResource", () => {
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

  it("lists a business's branches, optionally with archived ones", async () => {
    await withClient(
      () => ({ status: 200, body: [branch] }),
      async (client, seen) => {
        const result = await client.branches.list("s1");
        expect(seen[0]).toMatchObject({ method: "GET", url: "/v1/shop/branches?shopId=s1" });
        expect(result[0]!.name).toBe("Gulberg");

        await client.branches.list("s1", { includeArchived: true });
        expect(seen[1]!.url).toBe("/v1/shop/branches?shopId=s1&includeArchived=true");
      },
    );
  });

  it("creates a branch", async () => {
    await withClient(
      () => ({ status: 201, body: branch }),
      async (client, seen) => {
        await client.branches.create("s1", { name: "Gulberg", address: "5 Side Street" });
        expect(seen[0]).toMatchObject({
          method: "POST",
          url: "/v1/shop/branches",
          body: { shopId: "s1", name: "Gulberg", address: "5 Side Street" },
        });
      },
    );
  });

  it("edits a branch, sending only what changes", async () => {
    await withClient(
      () => ({ status: 200, body: branch }),
      async (client, seen) => {
        await client.branches.update("b1", { name: "Gulberg III", phone: null });
        expect(seen[0]).toMatchObject({
          method: "PATCH",
          url: "/v1/shop/branches/b1",
          body: { name: "Gulberg III", phone: null },
        });
      },
    );
  });

  it("opens or closes a branch", async () => {
    await withClient(
      () => ({ status: 200, body: branch }),
      async (client, seen) => {
        await client.branches.setOpen("b1", false);
        expect(seen[0]).toMatchObject({
          method: "PUT",
          url: "/v1/shop/branches/b1/open-state",
          body: { isOpen: false },
        });
      },
    );
  });

  it("archives a branch", async () => {
    await withClient(
      () => ({ status: 200, body: branch }),
      async (client, seen) => {
        await client.branches.archive("b1");
        expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/shop/branches/b1/archive" });
      },
    );
  });
});
