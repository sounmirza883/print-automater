const jar = new Map<string, string>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
jest.mock("@/env", () => ({
  webEnv: { NEXT_PUBLIC_API_BASE_URL: "http://api.test", NODE_ENV: "test" },
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const fetchMock = jest.fn();

beforeEach(() => {
  jar.clear();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CODE = "c".repeat(43);

function activate(body: unknown, origin = "http://localhost:3002"): NextRequest {
  return new NextRequest("http://localhost:3002/api/auth/activate", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "localhost:3002" },
    body: JSON.stringify(body),
  });
}

const valid = { email: "Owner@Example.com", password: "correct horse battery", code: CODE };
const activated = {
  user: { id: "u7", name: "Owner", email: "owner@example.com", role: "SHOP_OWNER" },
  accessToken: "access-7",
  refreshToken: "refresh-7",
  shopId: "shop-7",
  role: "SHOP_OWNER",
};
const urls = () => fetchMock.mock.calls.map((call) => String(call[0]));

describe("POST /api/auth/activate (fix wave 1)", () => {
  it("sets the password with the code in one public call and opens a session on that business", async () => {
    fetchMock.mockResolvedValueOnce(json(200, activated));
    const response = await POST(activate(valid));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ user: activated.user, shopId: "shop-7" });
    // No tokens ever reach the browser; they become httpOnly cookies.
    expect(JSON.stringify(body)).not.toContain("refresh-7");
    expect(urls()).toEqual(["http://api.test/v1/shop/staff-invites/activate"]);
    const call = fetchMock.mock.calls[0][1];
    // Public route: nothing to authenticate with, and nothing is sent as if there were.
    expect(call.headers.Authorization).toBeUndefined();
    expect(JSON.parse(call.body)).toEqual({
      email: "owner@example.com",
      token: CODE,
      password: "correct horse battery",
    });
    expect(jar.get("shop_refresh_token")).toBe("refresh-7");
  });

  it("answers every refused code the same way and opens no session", async () => {
    fetchMock.mockResolvedValueOnce(
      json(404, { error_code: "NOT_FOUND", message: "This invitation is invalid or has expired." }),
    );
    const response = await POST(activate(valid));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error_code).toBe("ACTIVATION_INVALID");
    expect(body.message).toMatch(/does not work with this email address/);
    expect(jar.size).toBe(0);
  });

  it("reports the API's rate limit as such", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error_code: "RATE_LIMITED", message: "slow" }));
    const response = await POST(activate(valid));
    expect(response.status).toBe(429);
    expect((await response.json()).error_code).toBe("RATE_LIMITED");
    expect(jar.size).toBe(0);
  });

  it("reports an unreachable or failing API as unreachable, with no session", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await POST(activate(valid))).status).toBe(502);
    fetchMock.mockResolvedValueOnce(json(500, { error_code: "INTERNAL" }));
    expect((await POST(activate(valid))).status).toBe(502);
    expect(jar.size).toBe(0);
  });

  it("refuses a malformed code, a short password or a bad email without calling the API", async () => {
    const short = await POST(activate({ ...valid, code: "short" }));
    expect(short.status).toBe(400);
    expect((await short.json()).message).toMatch(/code exactly/);
    const weak = await POST(activate({ ...valid, password: "short" }));
    expect((await weak.json()).message).toMatch(/at least 8 characters/);
    expect((await POST(activate({ ...valid, email: "nope" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post without calling the API", async () => {
    const response = await POST(activate(valid, "http://localhost:3001"));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
