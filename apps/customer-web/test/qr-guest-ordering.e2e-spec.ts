import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { UNREACHABLE_MESSAGE } from "../src/lib/public-api";
import { createPublicOrder } from "../src/lib/public-order";
import {
  runPublicUploadFlow,
  type PublicUploadDeps,
  type PublicUploadState,
} from "../src/lib/public-upload";

const WEB_BASE_URL = "http://localhost:3001";
const API_BASE_URL = "http://localhost:3000";

// Same real fixture golden-path.spec.ts's own real-worker upload uses --
// this suite proves the exact same document pipeline (create -> PUT ->
// confirm -> poll to READY) through this app's own client code, not a
// shortcut that writes DocumentStatus.READY by hand.
const FIXTURE_PDF = path.join(__dirname, "../../../services/worker/test/fixtures/valid.pdf");

const CONFIG = {
  pages: { mode: "all" as const },
  copies: 1,
  paperSize: "A4" as const,
  color: "BW" as const,
  sides: "SINGLE" as const,
  orientation: "PORTRAIT" as const,
};

const SAFELISTED_HEADERS = new Set(["accept", "accept-language", "content-language"]);
const SIMPLE_CONTENT_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

/** The fetch spec's "simple request" test: anything else is preflighted. */
function isSimpleRequest(method: string, headers: Headers): boolean {
  if (!["GET", "HEAD", "POST"].includes(method)) return false;
  for (const [name, value] of headers) {
    if (SAFELISTED_HEADERS.has(name)) continue;
    const mime = value.split(";")[0]!.trim().toLowerCase();
    if (name === "content-type" && SIMPLE_CONTENT_TYPES.has(mime)) continue;
    return false;
  }
  return true;
}

/** Fix wave 1: the QR wizard's browser code now calls the API's own public
 * routes directly, cross-origin from this app's origin, so what a browser
 * would enforce is part of what this suite has to prove. Node's fetch
 * enforces none of it, so this does: every call carries this app's
 * `Origin`; a non-simple one (JSON body, `Idempotency-Key`) is preflighted
 * first and must be admitted for that method and those headers; and a
 * response whose CORS headers don't admit this origin -- or don't expose
 * `Retry-After` to page code -- is refused exactly as a browser would
 * refuse it, by rejecting. */
const browserFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);

  if (!isSimpleRequest(method, headers)) {
    const names = [...headers.keys()];
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: WEB_BASE_URL,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": names.join(","),
      },
    });
    const allowedOrigin = preflight.headers.get("access-control-allow-origin");
    const allowedMethods = (preflight.headers.get("access-control-allow-methods") ?? "")
      .toUpperCase()
      .split(",")
      .map((value) => value.trim());
    const allowedHeaders = (preflight.headers.get("access-control-allow-headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim());
    if (
      !preflight.ok ||
      allowedOrigin !== WEB_BASE_URL ||
      !allowedMethods.includes(method) ||
      !names.every((name) => allowedHeaders.includes(name))
    ) {
      throw new TypeError(`CORS preflight refused ${method} ${url}`);
    }
  }

  headers.set("Origin", WEB_BASE_URL);
  const response = await fetch(url, { ...init, method, headers });
  if (response.headers.get("access-control-allow-origin") !== WEB_BASE_URL) {
    throw new TypeError(`CORS refused the response to ${method} ${url}`);
  }
  const exposed = (response.headers.get("access-control-expose-headers") ?? "").toLowerCase();
  if (!exposed.includes("retry-after")) {
    throw new TypeError(`Retry-After is not exposed on ${method} ${url}`);
  }
  return response;
};

/** The presigned PUT goes to object storage, not the API; XHR (the wizard's
 * real upload path, for progress) doesn't exist in Node, so this is the
 * same PUT through fetch. */
const nodeUploadDeps: PublicUploadDeps = {
  fetchImpl: browserFetch,
  uploadFile: async (url, file, onProgress) => {
    const put = await fetch(url, {
      method: "PUT",
      body: Buffer.from(await file.arrayBuffer()),
      headers: { "Content-Type": file.type },
    });
    if (!put.ok) {
      throw new Error(`Upload failed with status ${put.status}.`);
    }
    onProgress(100);
  },
};

async function upload(shopId: string, file: File): Promise<PublicUploadState[]> {
  const states: PublicUploadState[] = [];
  await runPublicUploadFlow(shopId, file, (state) => states.push(state), nodeUploadDeps);
  return states;
}

function fixtureFile(): File {
  return new File([readFileSync(FIXTURE_PDF)], "valid.pdf", { type: "application/pdf" });
}

/** 24.1's QR guest ordering, after fix wave 1 removed this app's
 * `/api/public/shops/*` proxy: verified as real HTTP against the real
 * running `next dev` + `nest start` servers and real Postgres/MinIO/Redis
 * (assumed already up), with NO cookie or auth header anywhere. What this
 * app still owns -- and so what this suite proves -- is its own client
 * code (`lib/public-upload.ts`, `lib/public-order.ts`) reaching the API's
 * public routes at the right URLs from this app's origin (CORS included),
 * reading the API's real answers, and carrying a guest end to end through
 * the real document pipeline (worker included) to a real placed order.
 * The routes' own rules (validation, shop scoping, rate limits) are
 * services/api/test/public-orders.e2e-spec.ts's job. */
describe("QR guest ordering from customer-web (24.1 + fix wave 1, real HTTP)", () => {
  let openShopId: string;
  const originalApiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

  beforeAll(async () => {
    // What `next build` inlines into the browser bundle; lib/public-api.ts
    // reads it at call time.
    process.env.NEXT_PUBLIC_API_BASE_URL = API_BASE_URL;
    // §17's discovery endpoint only ever lists OPEN shops -- the same
    // seeded shop orders-quote-proxy.e2e-spec.ts already relied on.
    const shopsRes = await fetch(`${API_BASE_URL}/v1/shops`);
    const shops = (await shopsRes.json()) as Array<{ id: string }>;
    if (shops.length === 0) {
      throw new Error("No seeded shops found -- run `pnpm db:seed` before this suite.");
    }
    openShopId = shops[0]!.id;
  });

  afterAll(() => {
    if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
  });

  it("serves the QR landing page, and no longer serves the removed proxy routes", async () => {
    const page = await fetch(`${WEB_BASE_URL}/s/${openShopId}/upload`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Print with this shop");

    const oldProxy = await fetch(`${WEB_BASE_URL}/api/public/shops/${openShopId}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(oldProxy.status).toBe(404);
  });

  /** A refusal the API itself sent -- proof the call got an answer through
   * CORS, rather than ending in the "could not reach" fallback. */
  function expectApiRefusal(state: PublicUploadState | undefined): void {
    expect(state).toEqual({ phase: "error", message: expect.any(String) });
    expect((state as { message: string }).message).not.toBe(UNREACHABLE_MESSAGE);
  }

  it("a malformed shop id ends the upload in an error state carrying the API's refusal", async () => {
    const states = await upload("not-a-uuid", fixtureFile());
    expect(states[0]).toEqual({ phase: "creating" });
    expectApiRefusal(states.at(-1));
  });

  it("a nonexistent (but well-formed) shop id ends the upload in an error state", async () => {
    const states = await upload(randomUUID(), fixtureFile());
    expectApiRefusal(states.at(-1));
  });

  it("an order missing its required fields is refused with the API's own validation message", async () => {
    const failure = await createPublicOrder(
      openShopId,
      "",
      "",
      randomUUID(),
      CONFIG,
      randomUUID(),
      browserFetch,
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toBe(UNREACHABLE_MESSAGE);
  });

  it("the full guest flow: upload -> worker -> READY -> place order (replay-safe), with a real publicOrderNumber back", async () => {
    const states = await upload(openShopId, fixtureFile());
    const phases = states.map((state) => state.phase);
    expect(phases[0]).toBe("creating");
    expect(phases).toContain("uploading");
    expect(phases).toContain("confirming");
    expect(phases).toContain("processing");
    const ready = states.at(-1)!;
    if (ready.phase !== "ready") {
      throw new Error(`Upload did not reach READY: ${JSON.stringify(ready)}`);
    }
    expect(ready.pageCount).toBeGreaterThan(0);

    const idempotencyKey = randomUUID();
    const order = await createPublicOrder(
      openShopId,
      "QR Guest E2E",
      "+92 300 555 1212",
      ready.documentId,
      CONFIG,
      idempotencyKey,
      browserFetch,
    );
    expect(typeof order.publicOrderNumber).toBe("string");
    expect(order.publicOrderNumber.length).toBeGreaterThan(0);
    expect(order.orderStatus).toBe("UPLOADED");
    expect(order.creationSource).toBe("QR");
    expect(order.shopId).toBe(openShopId);
    expect(order.pricingSnapshot.quote.totalMinor).toBeGreaterThan(0);

    // §92: a double-tap resends the same key; the Idempotency-Key header
    // must survive the cross-origin preflight for this to be a replay.
    const replay = await createPublicOrder(
      openShopId,
      "QR Guest E2E",
      "+92 300 555 1212",
      ready.documentId,
      CONFIG,
      idempotencyKey,
      browserFetch,
    );
    expect(replay.id).toBe(order.id);
    expect(replay.publicOrderNumber).toBe(order.publicOrderNumber);
  }, 90_000);
});
