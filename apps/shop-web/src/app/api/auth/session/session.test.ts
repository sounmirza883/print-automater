const jar = new Map<string, string>();
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
  }),
}));

import { GET } from "./route";

beforeEach(() => jar.clear());

const signIn = (role: string) => {
  jar.set("shop_refresh_token", "r");
  jar.set(
    "shop_session_user",
    JSON.stringify({ id: "u1", name: "Person", email: "p@example.com", role }),
  );
};

describe("GET /api/auth/session", () => {
  it("reports whoever sign-in admitted, including a CUSTOMER account that works at a business (23.23)", async () => {
    signIn("CUSTOMER");
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).user.role).toBe("CUSTOMER");
  });

  it("is 401 without a session or with a malformed display cookie", async () => {
    expect((await GET()).status).toBe(401);
    jar.set("shop_refresh_token", "r");
    jar.set("shop_session_user", "{not json");
    expect((await GET()).status).toBe(401);
    jar.set("shop_session_user", JSON.stringify({ id: "u1" }));
    expect((await GET()).status).toBe(401);
  });
});
