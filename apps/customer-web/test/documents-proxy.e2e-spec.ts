import { randomUUID } from "node:crypto";

const WEB_BASE_URL = "http://localhost:3001";

/** Same minimal cookie jar as auth-round-trip.e2e-spec.ts -- kept
 * file-local rather than shared, matching how every e2e-spec in this
 * project is self-contained. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  captureFrom(response: Response): void {
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (!name) continue;
      this.cookies.set(name.trim(), rest.join("="));
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** §4.5's proxy layer, verified as real HTTP against the real running
 * `next dev` + `nest start` servers and real Postgres/MinIO (assumed
 * already up) -- proves the httpOnly cookie really gets translated
 * into an `Authorization: Bearer` header reaching the real backend,
 * and that a caller with no session gets refused before that ever
 * happens. `lib/upload-document.test.ts` covers the client-side state
 * machine that calls these routes; this covers the routes themselves. */
describe("Documents proxy (4.5, real HTTP)", () => {
  const jar = new CookieJar();

  beforeAll(async () => {
    const email = `docs-proxy-e2e-${randomUUID()}@print-automated.dev`;
    const registerResponse = await fetch(`${WEB_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Docs Proxy E2E", email, password: "password123" }),
    });
    expect(registerResponse.status).toBe(200);
    jar.captureFrom(registerResponse);
  });

  it("an unauthenticated request is refused before it could ever reach the backend", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error_code: string };
    expect(body.error_code).toBe("UNAUTHENTICATED");
  });

  it("creates a document via the real backend, with the session cookie translated into a bearer token", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        filename: "proxy-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      }),
    });
    expect(response.status).toBe(201);

    const body = (await response.json()) as { documentId: string; uploadUrl: string };
    expect(typeof body.documentId).toBe("string");
    // A real presigned MinIO URL, not a stub -- proves the request
    // really reached services/api's storage layer, not a mock.
    expect(body.uploadUrl).toContain("quarantine");

    const statusResponse = await fetch(`${WEB_BASE_URL}/api/documents/${body.documentId}`, {
      headers: { Cookie: jar.header() },
    });
    expect(statusResponse.status).toBe(200);
    const status = (await statusResponse.json()) as { status: string; filename: string };
    expect(status.status).toBe("PENDING_UPLOAD");
    expect(status.filename).toBe("proxy-test.pdf");
  });

  it("a stranger's session cannot read someone else's document status through the proxy", async () => {
    // Create a document as the first user.
    const createResponse = await fetch(`${WEB_BASE_URL}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        filename: "owner-only.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    });
    const { documentId } = (await createResponse.json()) as { documentId: string };

    // A second, unrelated session.
    const strangerJar = new CookieJar();
    const strangerRegisterResponse = await fetch(`${WEB_BASE_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Docs Proxy Stranger",
        email: `docs-proxy-stranger-${randomUUID()}@print-automated.dev`,
        password: "password123",
      }),
    });
    strangerJar.captureFrom(strangerRegisterResponse);

    const strangerResponse = await fetch(`${WEB_BASE_URL}/api/documents/${documentId}`, {
      headers: { Cookie: strangerJar.header() },
    });
    expect(strangerResponse.status).toBe(403);
  });
});
