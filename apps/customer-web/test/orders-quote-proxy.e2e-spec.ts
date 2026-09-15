const WEB_BASE_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:3000";

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

/** §4.6's `/api/orders/quote` proxy, verified as real HTTP against the
 * real running dev stack (assumed already up, same as every other
 * e2e-spec in this project). What genuinely belongs to this app is the
 * cookie-to-bearer-token forwarding -- pricing correctness itself is
 * already exhaustively covered by services/api's own
 * orders-quote.e2e-spec.ts (4.4/4.6). Proving that here would need the
 * real worker running a document all the way to READY, which is a
 * heavier bar than this proxy layer's own correctness calls for; a
 * genuine backend refusal (409 DOCUMENT_NOT_READY, for a real but
 * still-PENDING_UPLOAD document) is just as strong a proof that
 * requests are reaching the real backend, authenticated, as a success
 * response would be. */
describe("Orders quote proxy (4.6, real HTTP)", () => {
  const jar = new CookieJar();
  let documentId: string;
  let shopId: string;

  beforeAll(async () => {
    // Logs into the seed's existing customer account (services/api/prisma/seed.ts)
    // rather than registering a new one -- this suite's own focus is the
    // quote proxy's auth-forwarding, not registration itself (already
    // covered by auth-round-trip.e2e-spec.ts), and register is far more
    // tightly rate-limited (S85: 3/hr per IP vs login's 5/15min).
    const loginResponse = await fetch(`${WEB_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer@print-automated.dev",
        password: "DevPassword123!",
      }),
    });
    if (!loginResponse.ok) {
      throw new Error(
        "Could not log into the seeded customer account -- run `pnpm db:seed` before this suite.",
      );
    }
    jar.captureFrom(loginResponse);

    const createResponse = await fetch(`${WEB_BASE_URL}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({
        filename: "quote-proxy-test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    });
    const created = (await createResponse.json()) as { documentId: string };
    documentId = created.documentId;

    // S17's discovery endpoint is public -- called directly against the
    // real backend, same as the browser itself would (lib/configure-quote.ts).
    const shopsResponse = await fetch(`${API_BASE_URL}/v1/shops`);
    const shops = (await shopsResponse.json()) as Array<{ id: string }>;
    if (shops.length === 0) {
      throw new Error("No seeded shops found -- run `pnpm db:seed` before this suite.");
    }
    shopId = shops[0]!.id;
  });

  const config = {
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  };

  it("an unauthenticated quote request is refused before reaching the backend", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/orders/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId, shopId, printConfiguration: config }),
    });
    expect(response.status).toBe(401);
  });

  it("forwards an authenticated request to the real backend, which genuinely evaluates it", async () => {
    const response = await fetch(`${WEB_BASE_URL}/api/orders/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: jar.header() },
      body: JSON.stringify({ documentId, shopId, printConfiguration: config }),
    });

    // The document is still PENDING_UPLOAD (never actually uploaded) --
    // the real backend refuses it for exactly that reason, proving the
    // request really reached services/api's own orders.service.ts
    // logic, authenticated as this session's user (a broken auth
    // forward would 401 here instead).
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error_code: string };
    expect(body.error_code).toBe("DOCUMENT_NOT_READY");
  });
});
