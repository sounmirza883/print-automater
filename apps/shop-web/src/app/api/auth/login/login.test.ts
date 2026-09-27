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

function login(): NextRequest {
  return new NextRequest("http://localhost:3002/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "correct horse battery" }),
  });
}

const tokens = { accessToken: "access-1", refreshToken: "refresh-1" };
const account = (role: string) => ({
  user: { id: "u1", name: "Person", email: "person@example.com", role },
  ...tokens,
});
const urls = () => fetchMock.mock.calls.map((call) => String(call[0]));

describe("POST /api/auth/login: who may use the back office (23.23)", () => {
  it("admits a staff account without asking which businesses it has", async () => {
    fetchMock.mockResolvedValueOnce(json(200, account("SHOP_OWNER")));
    const response = await POST(login());
    expect(response.status).toBe(200);
    expect(urls()).toEqual(["http://api.test/v1/auth/login"]);
    expect(jar.get("shop_refresh_token")).toBe("refresh-1");
  });

  it("admits a CUSTOMER account that works at a business (an accepted invitee)", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, account("CUSTOMER")))
      .mockResolvedValueOnce(
        json(200, { shops: [{ id: "shop-1", name: "Mock", role: "OPERATOR" }] }),
      );
    const response = await POST(login());
    expect(response.status).toBe(200);
    expect(urls()[1]).toBe("http://api.test/v1/shop/staff/me");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer access-1");
    expect(jar.get("shop_access_token")).toBe("access-1");
  });

  it("refuses a CUSTOMER account with no business, revokes its session and sets no cookie", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, account("CUSTOMER")))
      .mockResolvedValueOnce(json(200, { shops: [] }))
      .mockResolvedValueOnce(noContent());
    const response = await POST(login());
    expect(response.status).toBe(403);
    expect((await response.json()).error_code).toBe("NOT_BACK_OFFICE_ACCOUNT");
    expect(urls()[2]).toBe("http://api.test/v1/auth/logout");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ refreshToken: "refresh-1" });
    expect(jar.size).toBe(0);
  });

  it("does not open a session when it cannot tell whether the account works anywhere", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, account("CUSTOMER")))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(noContent());
    const response = await POST(login());
    expect(response.status).toBe(502);
    expect(urls()[2]).toBe("http://api.test/v1/auth/logout");
    expect(jar.size).toBe(0);
  });

  it("passes a failed sign-in straight through", async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error_code: "INVALID_CREDENTIALS", message: "No." }),
    );
    const response = await POST(login());
    expect(response.status).toBe(401);
    expect(urls()).toEqual(["http://api.test/v1/auth/login"]);
    expect(jar.size).toBe(0);
  });
});
