import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { HttpClient } from "./http-client.js";
import { ApiClientError } from "./errors/api-client-error.js";
import type { AuthStrategy } from "./auth/auth-strategy.js";

/** A real `node:http` server, not a mocked `fetch` -- this suite exists
 * to prove HttpClient's behavior over an actual socket (header casing,
 * concurrent connections, real async timing for the single-flight
 * dedup test below), which a hand-rolled fetch mock could get right by
 * accident. It does not stand in for services/api (that has its own
 * exhaustive e2e suite) -- it only ever asserts on HttpClient's own
 * request/response handling. */
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

function noopAuthStrategy(): AuthStrategy {
  return {
    getHeaders: async () => ({}),
    getRequestInit: () => ({}),
    refresh: async () => false,
  };
}

describe("HttpClient", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("makes a GET request and returns the parsed JSON body", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/v1/ping") {
        sendJson(res, 200, { hello: "world" });
        return;
      }
      sendJson(res, 404, {});
    });
    close = server.close;

    const client = new HttpClient({ baseUrl: server.baseUrl, authStrategy: noopAuthStrategy() });
    await expect(client.request("/v1/ping")).resolves.toEqual({ hello: "world" });
  });

  it("attaches headers and fetch-init overrides from the auth strategy", async () => {
    let seenAuthHeader: string | undefined;
    let seenCredentialsHeader: string | undefined;
    const server = await startServer((req, res) => {
      seenAuthHeader = req.headers.authorization;
      // The real signal a browser sends `credentials:"include"` isn't
      // observable server-side over plain HTTP without an actual cookie
      // jar; this asserts the header the strategy itself contributes
      // instead, which is what proves `getRequestInit()`'s return value
      // reached `fetch` at all.
      const marker = req.headers["x-test-marker"];
      seenCredentialsHeader = Array.isArray(marker) ? marker[0] : marker;
      sendJson(res, 200, {});
    });
    close = server.close;

    const strategy: AuthStrategy = {
      getHeaders: async () => ({ Authorization: "Bearer abc123" }),
      getRequestInit: () => ({ headers: { "X-Test-Marker": "present" } }),
      refresh: async () => false,
    };
    const client = new HttpClient({ baseUrl: server.baseUrl, authStrategy: strategy });
    await client.request("/v1/whoami");

    expect(seenAuthHeader).toBe("Bearer abc123");
    expect(seenCredentialsHeader).toBe("present");
  });

  it("applies query params and omits undefined values", async () => {
    let receivedUrl: string | undefined;
    const server = await startServer((req, res) => {
      receivedUrl = req.url;
      sendJson(res, 200, {});
    });
    close = server.close;

    const client = new HttpClient({ baseUrl: server.baseUrl, authStrategy: noopAuthStrategy() });
    await client.request("/v1/search", { query: { a: "1", b: 2, c: undefined } });

    expect(receivedUrl).toBe("/v1/search?a=1&b=2");
  });

  it("maps a non-2xx JSON error body to ApiClientError with the full §104 shape", async () => {
    const server = await startServer((_req, res) => {
      sendJson(res, 409, {
        error_code: "DOCUMENT_NOT_READY",
        message: "This document is not ready to download yet.",
        retryable: false,
        request_id: "req-1",
      });
    });
    close = server.close;

    const client = new HttpClient({ baseUrl: server.baseUrl, authStrategy: noopAuthStrategy() });
    const error = await client.request("/v1/documents/x/download").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    const apiError = error as ApiClientError;
    expect(apiError.status).toBe(409);
    expect(apiError.error_code).toBe("DOCUMENT_NOT_READY");
    expect(apiError.message).toBe("This document is not ready to download yet.");
    expect(apiError.retryable).toBe(false);
    expect(apiError.request_id).toBe("req-1");
  });

  it("never attaches auth or attempts refresh for authenticated:false requests, even on 401", async () => {
    const server = await startServer((_req, res) => {
      sendJson(res, 401, {
        error_code: "INVALID_CREDENTIALS",
        message: "Incorrect email or password.",
        retryable: false,
        request_id: "req-2",
      });
    });
    close = server.close;

    const refresh = jest.fn(async () => true);
    const client = new HttpClient({
      baseUrl: server.baseUrl,
      authStrategy: { getHeaders: async () => ({}), getRequestInit: () => ({}), refresh },
    });

    await expect(
      client.request("/v1/auth/login", { method: "POST", body: {}, authenticated: false }),
    ).rejects.toMatchObject({ error_code: "INVALID_CREDENTIALS" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("propagates the original 401 without retrying when refresh() reports it could not refresh", async () => {
    let hitCount = 0;
    const server = await startServer((_req, res) => {
      hitCount += 1;
      sendJson(res, 401, {
        error_code: "UNAUTHENTICATED",
        message: "Session expired.",
        retryable: false,
        request_id: "req-3",
      });
    });
    close = server.close;

    const client = new HttpClient({
      baseUrl: server.baseUrl,
      authStrategy: {
        getHeaders: async () => ({}),
        getRequestInit: () => ({}),
        refresh: async () => false,
      },
    });

    await expect(client.request("/v1/protected")).rejects.toMatchObject({
      error_code: "UNAUTHENTICATED",
    });
    expect(hitCount).toBe(1);
  });

  it("§3.1: five concurrent 401s trigger exactly one refresh, and all five then succeed", async () => {
    let refreshCount = 0;
    let tokenIsGood = false;
    let protectedHitCount = 0;

    const server = await startServer((req, res) => {
      if (req.url === "/v1/auth/refresh-mock") {
        refreshCount += 1;
        // A real (if brief) async gap -- long enough for the other four
        // concurrent callers' initial 401 round-trips to complete and
        // reach the dedup check before this one resolves, which is what
        // makes the single-flight behavior meaningfully exercised rather
        // than accidentally true.
        setTimeout(() => {
          tokenIsGood = true;
          sendJson(res, 200, {});
        }, 20);
        return;
      }
      if (req.url === "/v1/protected") {
        protectedHitCount += 1;
        if (req.headers.authorization === "Bearer good-token") {
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 401, {
            error_code: "UNAUTHENTICATED",
            message: "Session expired.",
            retryable: true,
            request_id: `req-${protectedHitCount}`,
          });
        }
        return;
      }
      sendJson(res, 404, {});
    });
    close = server.close;

    const refresh = jest.fn(async () => {
      await fetch(`${server.baseUrl}/v1/auth/refresh-mock`, { method: "POST" });
      return true;
    });
    const client = new HttpClient({
      baseUrl: server.baseUrl,
      authStrategy: {
        getHeaders: async (): Promise<Record<string, string>> =>
          tokenIsGood ? { Authorization: "Bearer good-token" } : {},
        getRequestInit: () => ({}),
        refresh,
      },
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.request("/v1/protected")),
    );

    expect(results).toEqual(Array.from({ length: 5 }, () => ({ ok: true })));
    expect(refreshCount).toBe(1);
    // 5 initial 401s + 5 successful retries.
    expect(protectedHitCount).toBe(10);
  });

  it("requestBlob returns raw bytes on success and ApiClientError on failure", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/v1/blob-ok") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(Buffer.from("hello-pdf"));
        return;
      }
      sendJson(res, 403, {
        error_code: "FORBIDDEN",
        message: "You do not have access to this document.",
        retryable: false,
        request_id: "req-4",
      });
    });
    close = server.close;

    const client = new HttpClient({ baseUrl: server.baseUrl, authStrategy: noopAuthStrategy() });

    const blob = await client.requestBlob("/v1/blob-ok");
    expect(Buffer.from(await blob.arrayBuffer()).toString()).toBe("hello-pdf");

    await expect(client.requestBlob("/v1/blob-forbidden")).rejects.toMatchObject({
      status: 403,
      error_code: "FORBIDDEN",
    });
  });
});
