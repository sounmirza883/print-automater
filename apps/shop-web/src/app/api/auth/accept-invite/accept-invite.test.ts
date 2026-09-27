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
const noContent = (): Response => new Response(null, { status: 204 });

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

function accept(body: unknown, origin = "http://localhost:3002"): NextRequest {
  return new NextRequest("http://localhost:3002/api/auth/accept-invite", {
    method: "POST",
    headers: { "content-type": "application/json", origin, host: "localhost:3002" },
    body: JSON.stringify(body),
  });
}

const valid = { email: "invitee@example.com", password: "correct horse battery", code: CODE };
const signedIn = {
  user: { id: "u9", name: "Invitee", email: "invitee@example.com", role: "CUSTOMER" },
  accessToken: "access-9",
  refreshToken: "refresh-9",
};
const urls = () => fetchMock.mock.calls.map((call) => String(call[0]));

describe("POST /api/auth/accept-invite (23.23)", () => {
  it("signs in, redeems the code with that session, and opens it on the business joined", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, signedIn))
      .mockResolvedValueOnce(json(200, { shopId: "shop-1", role: "OPERATOR" }))
      .mockResolvedValueOnce(
        json(200, { shops: [{ id: "shop-1", name: "Mock", role: "OPERATOR" }] }),
      );
    const response = await POST(accept(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ shopId: "shop-1" });
    expect(urls()).toEqual([
      "http://api.test/v1/auth/login",
      "http://api.test/v1/shop/staff-invites/accept",
      "http://api.test/v1/shop/staff/me",
    ]);
    const acceptCall = fetchMock.mock.calls[1][1];
    expect(acceptCall.headers.Authorization).toBe("Bearer access-9");
    expect(JSON.parse(acceptCall.body)).toEqual({ token: CODE });
    expect(jar.get("shop_refresh_token")).toBe("refresh-9");
  });

  it("answers every refused code the same way and revokes the session it just opened", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, signedIn))
      .mockResolvedValueOnce(json(404, { error_code: "NOT_FOUND", message: "anything" }))
      .mockResolvedValueOnce(noContent());
    const response = await POST(accept(valid));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error_code).toBe("INVITE_INVALID");
    expect(body.message).not.toContain("anything");
    expect(urls()[2]).toBe("http://api.test/v1/auth/logout");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ refreshToken: "refresh-9" });
    expect(jar.size).toBe(0);
  });

  it("reports the API's rate limit as such", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, signedIn))
      .mockResolvedValueOnce(json(429, { error_code: "RATE_LIMITED", message: "slow down" }))
      .mockResolvedValueOnce(noContent());
    const response = await POST(accept(valid));
    expect(response.status).toBe(429);
    expect(jar.size).toBe(0);
  });

  it("passes a failed sign-in through and never tries the code", async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error_code: "INVALID_CREDENTIALS", message: "No." }),
    );
    const response = await POST(accept(valid));
    expect(response.status).toBe(401);
    expect(urls()).toEqual(["http://api.test/v1/auth/login"]);
  });

  it("refuses a malformed code or missing credentials without calling the API", async () => {
    expect((await POST(accept({ ...valid, code: "short" }))).status).toBe(400);
    expect((await POST(accept({ code: CODE }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post without calling the API", async () => {
    const response = await POST(accept(valid, "http://localhost:3001"));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
