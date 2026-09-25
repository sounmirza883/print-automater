const jar = new Map<string, string>();
const deleted: string[] = [];
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => {
      deleted.push(name);
      jar.delete(name);
    },
  }),
}));
jest.mock("@/env", () => ({
  webEnv: { NEXT_PUBLIC_API_BASE_URL: "http://api.test", NODE_ENV: "test" },
}));

import { POST } from "./route";

const fetchMock = jest.fn();

beforeEach(() => {
  jar.clear();
  deleted.length = 0;
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/auth/refresh", () => {
  it("is 401 with no refresh cookie and never calls the API", async () => {
    const response = await POST();
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rotates both cookies from the API's new pair", async () => {
    jar.set("shop_refresh_token", "old-1");
    fetchMock.mockResolvedValue(json(200, { accessToken: "a2", refreshToken: "r2" }));
    const response = await POST();
    expect(response.status).toBe(200);
    expect(jar.get("shop_access_token")).toBe("a2");
    expect(jar.get("shop_refresh_token")).toBe("r2");
  });

  it("sends two simultaneous refreshes carrying the same token to the API ONCE (rotation reuse would revoke the session)", async () => {
    jar.set("shop_refresh_token", "old-shared");
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    const first = POST();
    const second = POST();
    // Let both reach the in-flight wait, then answer the single backend call.
    await new Promise((resolve) => setTimeout(resolve, 10));
    release(json(200, { accessToken: "a3", refreshToken: "r3" }));

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears the whole session when the API rejects the refresh token", async () => {
    jar.set("shop_refresh_token", "revoked-1");
    jar.set("shop_access_token", "stale");
    fetchMock.mockResolvedValue(json(401, { error_code: "INVALID_REFRESH_TOKEN", message: "no" }));
    const response = await POST();
    expect(response.status).toBe(401);
    expect(deleted).toEqual(
      expect.arrayContaining(["shop_access_token", "shop_refresh_token", "shop_session_user"]),
    );
  });

  it("keeps the session on a transient API failure so a retry can still succeed", async () => {
    jar.set("shop_refresh_token", "flaky-1");
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const response = await POST();
    expect(response.status).toBe(502);
    expect(deleted).toEqual([]);
  });
});
