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

/** Manual plan billing: the request shapes the Billing and admin review screens rely on. */
describe("PaymentProofsResource", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function withClient(
    reply: (req: IncomingMessage) => { status: number; body: unknown; raw?: Buffer; type?: string },
    run: (client: ApiClient, seen: Seen[]) => Promise<void>,
  ): Promise<void> {
    const seen: Seen[] = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined });
        const { status, body, raw: bytes, type } = reply(req);
        res.writeHead(status, { "Content-Type": type ?? "application/json" });
        res.end(bytes ?? JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const strategy = new BearerTokenAuthStrategy({ baseUrl, storage: new InMemoryTokenStorage() });
    await run(new ApiClient({ baseUrl, authStrategy: strategy }), seen);
  }

  it("submit posts the proof body to /v1/shop/payment-proofs", async () => {
    await withClient(
      () => ({ status: 201, body: { id: "p1", status: "PENDING" } }),
      async (client, seen) => {
        const body = {
          shopId: "s1",
          planDefinitionId: "plan1",
          amountMinor: 600_000,
          transactionRef: "TX-1",
          fileName: "r.png",
          fileContentType: "image/png" as const,
          fileBase64: "AAAA",
        };
        const created = await client.paymentProofs.submit(body);
        expect(created.id).toBe("p1");
        expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/shop/payment-proofs", body });
      },
    );
  });

  it("list and file carry the shopId query; instructions need none", async () => {
    await withClient(
      (req) =>
        req.url?.includes("/file")
          ? { status: 200, body: null, raw: Buffer.from("PNGDATA"), type: "image/png" }
          : { status: 200, body: [] },
      async (client, seen) => {
        await client.paymentProofs.list("s1");
        const blob = await client.paymentProofs.file("s1", "p1");
        expect(await blob.text()).toBe("PNGDATA");
        expect(blob.type).toBe("image/png");
        await client.paymentProofs.instructions();
        expect(seen.map((s) => s.url)).toEqual([
          "/v1/shop/payment-proofs?shopId=s1",
          "/v1/shop/payment-proofs/p1/file?shopId=s1",
          "/v1/shop/payment-instructions",
        ]);
      },
    );
  });

  it("adminList filters by status; approve sends months; reject sends the reason", async () => {
    await withClient(
      () => ({ status: 200, body: { items: [], total: 0, limit: 50, offset: 0 } }),
      async (client, seen) => {
        await client.paymentProofs.adminList({ status: "PENDING", limit: 20 });
        await client.paymentProofs.adminApprove("p1", { months: 12 });
        await client.paymentProofs.adminReject("p2", "Amount does not match");
        expect(seen[0]?.url).toBe("/v1/admin/payment-proofs?status=PENDING&limit=20");
        expect(seen[1]).toMatchObject({
          method: "POST",
          url: "/v1/admin/payment-proofs/p1/approve",
          body: { months: 12 },
        });
        expect(seen[2]).toMatchObject({
          method: "POST",
          url: "/v1/admin/payment-proofs/p2/reject",
          body: { reason: "Amount does not match" },
        });
      },
    );
  });

  it("admin payment instructions are read with GET and saved with PUT", async () => {
    await withClient(
      () => ({ status: 200, body: { paymentInstructions: "Bank X", updatedAt: "2026-10-11" } }),
      async (client, seen) => {
        await client.paymentProofs.adminInstructions();
        await client.paymentProofs.adminUpdateInstructions("Bank X");
        expect(seen[0]).toMatchObject({ method: "GET", url: "/v1/admin/payment-instructions" });
        expect(seen[1]).toMatchObject({
          method: "PUT",
          url: "/v1/admin/payment-instructions",
          body: { paymentInstructions: "Bank X" },
        });
      },
    );
  });

  it("adminReport sends the range and the viewer's offset; export adds the format and returns the file", async () => {
    await withClient(
      (req) =>
        req.url?.includes("/export")
          ? { status: 200, body: null, raw: Buffer.from("a,b"), type: "text/csv" }
          : { status: 200, body: { from: "x", to: "y", groupBy: "day", currencies: [] } },
      async (client, seen) => {
        const query = {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-11-01T00:00:00.000Z",
          tzOffsetMinutes: 300,
        };
        await client.paymentProofs.adminReport({ ...query, groupBy: "month" });
        const blob = await client.paymentProofs.adminExportReport(query, "csv");
        expect(await blob.text()).toBe("a,b");
        expect(seen[0]?.url).toBe(
          "/v1/admin/payment-reports?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z&tzOffsetMinutes=300&groupBy=month",
        );
        expect(seen[1]?.url).toContain("/v1/admin/payment-reports/export?");
        expect(seen[1]?.url).toContain("format=csv");
      },
    );
  });
});
