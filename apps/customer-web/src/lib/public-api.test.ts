import { createPublicOrder } from "./public-order";
import { UNREACHABLE_MESSAGE, publicApiUrl, rateLimitedMessage } from "./public-api";
import {
  runPublicUploadFlow,
  type PublicUploadDeps,
  type PublicUploadState,
} from "./public-upload";

const ENV_KEY = "NEXT_PUBLIC_API_BASE_URL";
const SHOP = "3f2b8c1e-9d4a-4c7e-8a55-0b6f1d2e3a4c";
const DOC = "11111111-2222-3333-4444-555555555555";

const original = process.env[ENV_KEY];
beforeEach(() => {
  process.env[ENV_KEY] = "https://api.example.test/";
});
afterAll(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const pdf = (): File => new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });

describe("publicApiUrl (fix wave 1: the browser calls the API directly)", () => {
  it("roots a path at the API's own origin, never this app's", () => {
    expect(publicApiUrl(`/v1/public/shops/${SHOP}/orders`)).toBe(
      `https://api.example.test/v1/public/shops/${SHOP}/orders`,
    );
  });
});

describe("rateLimitedMessage", () => {
  it("says how long to wait, from Retry-After seconds", () => {
    expect(rateLimitedMessage("1")).toBe(
      "Too many attempts from this connection. Please try again in 1 second.",
    );
    expect(rateLimitedMessage("42")).toContain("try again in 42 seconds.");
    expect(rateLimitedMessage("60")).toContain("try again in 1 minute.");
    expect(rateLimitedMessage("3599")).toContain("try again in 60 minutes.");
  });

  it("falls back to plain words when the header is missing or unreadable", () => {
    for (const value of [null, "", "soon", "0", "-5"]) {
      expect(rateLimitedMessage(value)).toBe(
        "Too many attempts from this connection. Please wait a while and try again.",
      );
    }
  });
});

describe("runPublicUploadFlow against the API's own routes", () => {
  function deps(responses: Response[], urls: string[]): PublicUploadDeps {
    return {
      fetchImpl: async (input) => {
        urls.push(String(input));
        const next = responses.shift();
        if (next === undefined) throw new Error("unexpected call");
        return next;
      },
      uploadFile: async (_url, _file, onProgress) => onProgress(100),
    };
  }

  it("creates, confirms and polls at /v1/public/shops/:shopId/documents* on the API origin", async () => {
    const urls: string[] = [];
    const states: PublicUploadState[] = [];
    await runPublicUploadFlow(
      SHOP,
      pdf(),
      (state) => states.push(state),
      deps(
        [
          json(201, { documentId: DOC, uploadUrl: "https://storage.example.test/put" }),
          json(200, { status: "PROCESSING" }),
          json(200, { id: DOC, filename: "notes.pdf", status: "READY", pageCount: 3 }),
        ],
        urls,
      ),
    );
    expect(urls).toEqual([
      `https://api.example.test/v1/public/shops/${SHOP}/documents`,
      `https://api.example.test/v1/public/shops/${SHOP}/documents/${DOC}/upload`,
      `https://api.example.test/v1/public/shops/${SHOP}/documents/${DOC}`,
    ]);
    expect(states.at(-1)).toEqual({
      phase: "ready",
      documentId: DOC,
      filename: "notes.pdf",
      pageCount: 3,
    });
  });

  it("turns a 429 into a wait time read from Retry-After", async () => {
    const states: PublicUploadState[] = [];
    await runPublicUploadFlow(
      SHOP,
      pdf(),
      (state) => states.push(state),
      deps(
        [
          json(
            429,
            { error_code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
            { "Retry-After": "120" },
          ),
        ],
        [],
      ),
    );
    expect(states.at(-1)).toEqual({
      phase: "error",
      message: "Too many attempts from this connection. Please try again in 2 minutes.",
    });
  });

  it("keeps the backend's own message for any other refusal", async () => {
    const states: PublicUploadState[] = [];
    await runPublicUploadFlow(
      SHOP,
      pdf(),
      (state) => states.push(state),
      deps([json(409, { error_code: "SHOP_NOT_OPEN", message: "This shop is closed." })], []),
    );
    expect(states.at(-1)).toEqual({ phase: "error", message: "This shop is closed." });
  });

  it("ends in an error state, not a stuck spinner, when the call gets no answer (offline, or CORS)", async () => {
    const states: PublicUploadState[] = [];
    await runPublicUploadFlow(SHOP, pdf(), (state) => states.push(state), {
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
      uploadFile: async () => undefined,
    });
    expect(states).toEqual([
      { phase: "creating" },
      { phase: "error", message: UNREACHABLE_MESSAGE },
    ]);
  });
});

describe("createPublicOrder against the API's own route", () => {
  const config = {
    pages: { mode: "all" as const },
    copies: 1,
    paperSize: "A4" as const,
    color: "BW" as const,
    sides: "SINGLE" as const,
    orientation: "PORTRAIT" as const,
  };

  it("posts to /v1/public/shops/:shopId/orders on the API origin with the caller's Idempotency-Key", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const order = await createPublicOrder(
      SHOP,
      "Guest",
      "+92 300 555 1212",
      DOC,
      config as never,
      "key-1",
      async (input, init) => {
        calls.push({ url: String(input), init });
        return json(201, { id: "order-1", publicOrderNumber: "PA-1" });
      },
    );
    expect(order.publicOrderNumber).toBe("PA-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.example.test/v1/public/shops/${SHOP}/orders`);
    expect((calls[0]!.init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
  });

  it("throws readable words for a rate limit and for no answer at all", async () => {
    await expect(
      createPublicOrder(SHOP, "G", "+923005551212", DOC, config as never, "k", async () =>
        json(429, { error_code: "RATE_LIMITED" }, { "Retry-After": "30" }),
      ),
    ).rejects.toThrow("Please try again in 30 seconds.");
    await expect(
      createPublicOrder(SHOP, "G", "+923005551212", DOC, config as never, "k", async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow(UNREACHABLE_MESSAGE);
  });
});
