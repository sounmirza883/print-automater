import { NextRequest } from "next/server";

const cookieJar = new Map<string, string>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
  }),
}));
jest.mock("@/env", () => ({ webEnv: { NEXT_PUBLIC_API_BASE_URL: "http://api.test" } }));

import { proxyToBackend } from "./authenticated-proxy";

const fetchMock = jest.fn();

beforeEach(() => {
  cookieJar.clear();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

function request(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: string } = {},
) {
  return new NextRequest(`http://localhost:3002${path}`, {
    method,
    headers: { host: "localhost:3002", ...init.headers },
    body: init.body,
  });
}

function backendJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("proxyToBackend", () => {
  it("answers 401 without ever calling the API when there is no access cookie", async () => {
    const response = await proxyToBackend(request("GET", "/api/v1/shop/dashboard/owner"), [
      "shop",
      "dashboard",
      "owner",
    ]);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error_code: string }).error_code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the cookie's token as a bearer header, with the query string, and relays the body", async () => {
    cookieJar.set("shop_access_token", "tok-123");
    fetchMock.mockResolvedValue(backendJson(200, { ok: 1 }));

    const response = await proxyToBackend(
      request("GET", "/api/v1/shop/dashboard/owner?shopId=s1&from=2026-09-01"),
      ["shop", "dashboard", "owner"],
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: 1 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/v1/shop/dashboard/owner?shopId=s1&from=2026-09-01");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("never forwards the browser's cookies or origin to the API", async () => {
    cookieJar.set("shop_access_token", "tok");
    fetchMock.mockResolvedValue(backendJson(200, {}));
    await proxyToBackend(
      request("GET", "/api/v1/shop/printers", {
        headers: { cookie: "shop_access_token=tok", origin: "http://localhost:3002" },
      }),
      ["shop", "printers"],
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const names = Object.keys(init.headers as Record<string, string>).map((n) => n.toLowerCase());
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("origin");
  });

  it("relays 403 and 409 bodies verbatim so the UI can branch on error_code", async () => {
    cookieJar.set("shop_access_token", "tok");
    fetchMock.mockResolvedValueOnce(backendJson(403, { error_code: "FORBIDDEN", message: "no" }));
    const forbidden = await proxyToBackend(request("GET", "/api/v1/shop/dashboard/owner"), [
      "shop",
      "dashboard",
      "owner",
    ]);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error_code: "FORBIDDEN", message: "no" });

    fetchMock.mockResolvedValueOnce(backendJson(409, { error_code: "SETTINGS_VERSION_CONFLICT" }));
    const conflict = await proxyToBackend(
      request("PUT", "/api/v1/shop/settings", {
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
      ["shop", "settings"],
    );
    expect(conflict.status).toBe(409);
  });

  it("passes the body, content type and Idempotency-Key on a mutation", async () => {
    cookieJar.set("shop_access_token", "tok");
    fetchMock.mockResolvedValue(backendJson(201, {}));
    await proxyToBackend(
      request("POST", "/api/v1/shop/inventory/items/i1/movements", {
        body: '{"delta":5}',
        headers: {
          "content-type": "application/json",
          "idempotency-key": "k-1",
          origin: "http://localhost:3002",
        },
      }),
      ["shop", "inventory", "items", "i1", "movements"],
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"delta":5}');
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k-1");
  });

  it("refuses a cross-origin mutation before touching the API", async () => {
    cookieJar.set("shop_access_token", "tok");
    const response = await proxyToBackend(
      request("POST", "/api/v1/shop/printers", {
        body: "{}",
        headers: { origin: "http://localhost:3001" },
      }),
      ["shop", "printers"],
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a path outside the allowed areas without calling the API", async () => {
    cookieJar.set("shop_access_token", "tok");
    const response = await proxyToBackend(request("POST", "/api/v1/auth/logout"), [
      "auth",
      "logout",
    ]);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles a 204 without a body", async () => {
    cookieJar.set("shop_access_token", "tok");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await proxyToBackend(request("DELETE", "/api/v1/shop/printers/p1"), [
      "shop",
      "printers",
      "p1",
    ]);
    expect(response.status).toBe(204);
  });

  it("turns an unreachable API into a 502 the UI can describe", async () => {
    cookieJar.set("shop_access_token", "tok");
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await proxyToBackend(request("GET", "/api/v1/shop/printers"), [
      "shop",
      "printers",
    ]);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error_code: string }).error_code).toBe(
      "UPSTREAM_UNREACHABLE",
    );
  });
});
