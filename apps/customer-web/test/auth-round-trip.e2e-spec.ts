import { randomUUID } from "node:crypto";

const WEB_BASE_URL = "http://localhost:3001";

/** Node's `fetch` has no cookie jar -- this is the minimal one needed to
 * prove the real round trip end to end: capture every `Set-Cookie`
 * header a response sends and replay the accumulated jar as a `Cookie`
 * header on the next request, exactly like a browser would. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  captureFrom(response: Response): void {
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      // next/headers' cookies().delete() emits an empty value with a
      // past Expires date (Thu, 01 Jan 1970), not Max-Age=0 -- confirmed
      // by inspecting the real logout response's raw Set-Cookie headers,
      // not assumed.
      const attrs = setCookie.toLowerCase();
      if (attrs.includes("max-age=0") || attrs.includes("expires=thu, 01 jan 1970")) {
        this.cookies.delete(name.trim());
      } else {
        this.cookies.set(name.trim(), rest.join("="));
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

/** §3.3's own Done-when, verified as real HTTP traffic against the real
 * `next dev`/`nest start` servers and the real dev Postgres/Redis
 * (assumed already up, same convention every other integration/e2e
 * suite in this project makes) -- register really argon2id-hashes a
 * password and issues a real JWT pair via services/api, this app's own
 * route handlers really convert that into httpOnly cookies, and
 * middleware really gates /dashboard on their presence. This exercises
 * exactly the same requests a browser would make; `test:browser`
 * (Playwright, apps/customer-web/e2e/) additionally proves the
 * rendered UI itself, where a real browser is available to run it. */
describe("Customer web auth round trip (3.3, real HTTP)", () => {
  const jar = new CookieJar();
  const email = `http-e2e-${randomUUID()}@print-automated.dev`;
  const password = "password123";

  it("an unauthenticated GET /dashboard redirects to /login", async () => {
    const response = await fetch(`${WEB_BASE_URL}/dashboard`, { redirect: "manual" });
    expect([302, 303, 307, 308]).toContain(response.status);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("registering sets httpOnly session cookies and returns only { user }, never raw tokens", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "HTTP E2E", email, password }),
    });
    expect(response.status).toBe(200);
    jar.captureFrom(response);

    const body = (await response.json()) as Record<string, unknown>;
    expect((body.user as { email: string }).email).toBe(email);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();

    const setCookies = response.headers.getSetCookie();
    const accessCookie = setCookies.find((cookie) => cookie.startsWith("access_token="));
    expect(accessCookie).toBeDefined();
    expect(accessCookie?.toLowerCase()).toContain("httponly");
  });

  it("the resulting session cookie reaches the protected /dashboard route", async () => {
    const response = await fetch(`${WEB_BASE_URL}/dashboard`, {
      headers: { Cookie: jar.header() },
      redirect: "manual",
    });
    expect(response.status).toBe(200);
  });

  it("logging out clears the session cookies, and the dashboard is unreachable again", async () => {
    const logoutResponse = await fetch(`${WEB_BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: jar.header() },
    });
    expect(logoutResponse.status).toBe(200);
    jar.captureFrom(logoutResponse);
    expect(jar.has("access_token")).toBe(false);
    expect(jar.has("refresh_token")).toBe(false);

    const dashboardResponse = await fetch(`${WEB_BASE_URL}/dashboard`, {
      headers: jar.header().length > 0 ? { Cookie: jar.header() } : {},
      redirect: "manual",
    });
    expect([302, 303, 307, 308]).toContain(dashboardResponse.status);
    expect(dashboardResponse.headers.get("location")).toContain("/login");
  });

  it("logging back in with the same credentials reaches the dashboard again", async () => {
    // Reuses the email registered above -- Jest runs `it`s within a
    // `describe` in declaration order, so this really is the round trip
    // §3.3 asks for: register -> dashboard -> logout -> redirected ->
    // log back in -> dashboard, not five independent assertions.
    const loginResponse = await fetch(`${WEB_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(loginResponse.status).toBe(200);
    jar.captureFrom(loginResponse);

    const dashboardResponse = await fetch(`${WEB_BASE_URL}/dashboard`, {
      headers: { Cookie: jar.header() },
      redirect: "manual",
    });
    expect(dashboardResponse.status).toBe(200);
  });

  it("a wrong password is rejected with a 4xx and sets no session cookie", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});
