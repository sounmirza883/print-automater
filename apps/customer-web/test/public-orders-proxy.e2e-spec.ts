import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const WEB_BASE_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:3000";

// Same real fixture golden-path.spec.ts's own real-worker upload uses --
// this suite proves the exact same document pipeline (create -> PUT ->
// confirm -> poll to READY) through this app's own public proxy routes,
// not a shortcut that writes DocumentStatus.READY by hand.
const FIXTURE_PDF = path.join(__dirname, "../../../services/worker/test/fixtures/valid.pdf");

const CONFIG = {
  pages: { mode: "all" },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

async function pollUntilReady(
  shopId: string,
  documentId: string,
): Promise<{ status: string; pageCount: number | null }> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${WEB_BASE_URL}/api/public/shops/${shopId}/documents/${documentId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; pageCount: number | null };
    if (body.status === "READY" || body.status === "REJECTED") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Document never settled within 30s.");
}

/** 24.1's public QR-ordering proxy (`app/api/public/shops/[shopId]/*`),
 * verified as real HTTP against the real running `next dev` + `nest
 * start` servers and real Postgres/MinIO/Redis (assumed already up),
 * with NO cookie or auth header anywhere -- this whole surface takes
 * none. `lib/public-upload.ts`'s and `lib/public-order.ts`'s own state
 * machines are exercised indirectly through these same routes; what
 * this suite proves is that this app's proxy layer reaches the real
 * backend and relays its real answers, end to end through the real
 * document pipeline (worker included) to a real placed order. */
describe("Public orders proxy (24.1, real HTTP)", () => {
  let openShopId: string;

  beforeAll(async () => {
    // §17's discovery endpoint only ever lists OPEN shops -- the same
    // seeded shop orders-quote-proxy.e2e-spec.ts already relies on.
    const shopsRes = await fetch(`${API_BASE_URL}/v1/shops`);
    const shops = (await shopsRes.json()) as Array<{ id: string }>;
    if (shops.length === 0) {
      throw new Error("No seeded shops found -- run `pnpm db:seed` before this suite.");
    }
    openShopId = shops[0]!.id;
  });

  it("a malformed shop id is refused before it could ever reach the backend's own document logic", async () => {
    const res = await fetch(`${WEB_BASE_URL}/api/public/shops/not-a-uuid/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("a nonexistent (but well-formed) shop id 404s", async () => {
    const res = await fetch(`${WEB_BASE_URL}/api/public/shops/${randomUUID()}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.pdf", mimeType: "application/pdf", sizeBytes: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it("an order missing its required fields is refused (400), with no Idempotency-Key needed to get that far", async () => {
    const res = await fetch(`${WEB_BASE_URL}/api/public/shops/${openShopId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("the full guest flow: create -> PUT bytes -> confirm -> poll to READY -> place order, with a real publicOrderNumber back", async () => {
    const bytes = readFileSync(FIXTURE_PDF);

    const createRes = await fetch(`${WEB_BASE_URL}/api/public/shops/${openShopId}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "valid.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
      }),
    });
    expect(createRes.status).toBe(201);
    const { documentId, uploadUrl } = (await createRes.json()) as {
      documentId: string;
      uploadUrl: string;
    };
    expect(typeof documentId).toBe("string");
    // A real presigned MinIO url, not a stub -- proves this really
    // reached services/api's own storage layer through the proxy.
    expect(uploadUrl).toContain("quarantine");

    const put = await fetch(uploadUrl, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(put.ok).toBe(true);

    const confirmRes = await fetch(
      `${WEB_BASE_URL}/api/public/shops/${openShopId}/documents/${documentId}/upload`,
      { method: "POST" },
    );
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as { status: string };
    expect(confirmed.status).toBe("PROCESSING");

    const settled = await pollUntilReady(openShopId, documentId);
    expect(settled.status).toBe("READY");
    expect(settled.pageCount).toBeGreaterThan(0);

    const orderRes = await fetch(`${WEB_BASE_URL}/api/public/shops/${openShopId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        name: "Public Proxy E2E Guest",
        phone: "+92 300 555 1212",
        documentId,
        printConfiguration: CONFIG,
      }),
    });
    expect(orderRes.status).toBe(201);
    const order = (await orderRes.json()) as {
      publicOrderNumber: string;
      orderStatus: string;
      creationSource: string;
      shopId: string;
    };
    expect(typeof order.publicOrderNumber).toBe("string");
    expect(order.publicOrderNumber.length).toBeGreaterThan(0);
    expect(order.orderStatus).toBe("UPLOADED");
    expect(order.creationSource).toBe("QR");
    expect(order.shopId).toBe(openShopId);
  }, 45_000);
});
