import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ApiClient } from "./client.js";
import {
  InMemoryTokenStorage,
  BearerTokenAuthStrategy,
} from "./auth/bearer-token-auth-strategy.js";

/** Proves `ApiClient`'s resource methods hit the exact routes
 * services/api actually exposes (services/api/src/auth/auth.controller.ts,
 * services/api/src/documents/documents.controller.ts) -- a typo in a
 * path or method here would otherwise only surface the first time a real
 * app called it, well after this package's own tests were green. */
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

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString();
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

interface SeenRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

function newClient(baseUrl: string): ApiClient {
  const strategy = new BearerTokenAuthStrategy({ baseUrl, storage: new InMemoryTokenStorage() });
  return new ApiClient({ baseUrl, authStrategy: strategy });
}

describe("ApiClient resource routing", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("routes every auth resource method to its real services/api endpoint", async () => {
    const requests: SeenRequest[] = [];
    const server = await startServer((req, res) => {
      void readBody(req).then((body) => {
        requests.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
        });
        sendJson(res, req.url === "/v1/auth/register" || req.url === "/v1/auth/login" ? 201 : 200, {
          user: { id: "u1", name: "Ann", email: "ann@example.com", role: "CUSTOMER" },
          accessToken: "a",
          refreshToken: "r",
        });
      });
    });
    close = server.close;

    const client = newClient(server.baseUrl);

    await client.auth.register({ name: "Ann", email: "ann@example.com", password: "password123" });
    await client.auth.login({ email: "ann@example.com", password: "password123" });
    await client.auth.refresh("some-refresh-token");
    await client.auth.logout("some-refresh-token");
    await client.auth.recovery({ email: "ann@example.com" });

    expect(requests).toEqual([
      expect.objectContaining({ method: "POST", url: "/v1/auth/register" }),
      expect.objectContaining({ method: "POST", url: "/v1/auth/login" }),
      expect.objectContaining({
        method: "POST",
        url: "/v1/auth/refresh",
        body: { refreshToken: "some-refresh-token" },
      }),
      expect.objectContaining({
        method: "POST",
        url: "/v1/auth/logout",
        body: { refreshToken: "some-refresh-token" },
      }),
      expect.objectContaining({
        method: "POST",
        url: "/v1/auth/recovery",
        body: { email: "ann@example.com" },
      }),
    ]);
    // None of the five auth calls carry a stale bearer token -- they run
    // with authenticated:false, per auth.resource.ts's own contract.
    expect(requests.every((r) => r.authorization === undefined)).toBe(true);
  });

  it("routes every documents resource method to its real services/api endpoint, with auth attached", async () => {
    const requests: SeenRequest[] = [];
    const server = await startServer((req, res) => {
      void readBody(req).then((body) => {
        requests.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
        });
        if (req.url?.endsWith("/download")) {
          res.writeHead(200, { "Content-Type": "application/pdf" });
          res.end(Buffer.from("pdf-bytes"));
          return;
        }
        if (req.method === "DELETE") {
          res.writeHead(204);
          res.end();
          return;
        }
        sendJson(res, 200, {
          id: "doc-1",
          filename: "a.pdf",
          status: "READY",
          pageCount: 1,
          rejectionReason: null,
          createdAt: "2026-01-01",
        });
      });
    });
    close = server.close;

    const storage = new InMemoryTokenStorage();
    await storage.setTokens({ accessToken: "access-token", refreshToken: "refresh-token" });
    const authedClient = new ApiClient({
      baseUrl: server.baseUrl,
      authStrategy: new BearerTokenAuthStrategy({ baseUrl: server.baseUrl, storage }),
    });

    await authedClient.documents.create({
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    await authedClient.documents.confirmUpload("doc-1");
    await authedClient.documents.getStatus("doc-1");
    const blob = await authedClient.documents.download("doc-1");
    await authedClient.documents.remove("doc-1");

    expect(requests).toEqual([
      expect.objectContaining({ method: "POST", url: "/v1/documents" }),
      expect.objectContaining({ method: "POST", url: "/v1/documents/doc-1/upload" }),
      expect.objectContaining({ method: "GET", url: "/v1/documents/doc-1" }),
      expect.objectContaining({ method: "GET", url: "/v1/documents/doc-1/download" }),
      expect.objectContaining({ method: "DELETE", url: "/v1/documents/doc-1" }),
    ]);
    expect(requests.every((r) => r.authorization === "Bearer access-token")).toBe(true);
    expect(Buffer.from(await blob.arrayBuffer()).toString()).toBe("pdf-bytes");
  });
});
