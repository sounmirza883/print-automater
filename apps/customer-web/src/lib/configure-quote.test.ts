import {
  debounce,
  fetchMatchingShops,
  fetchQuote,
  validatePageSelection,
  type QuoteResult,
  type ShopListItem,
} from "./configure-quote.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("validatePageSelection", () => {
  it("accepts 'all pages'", () => {
    expect(validatePageSelection({ mode: "all" }, 10)).toBeNull();
  });

  it("accepts an in-bounds range", () => {
    expect(validatePageSelection({ mode: "range", from: 2, to: 5 }, 10)).toBeNull();
  });

  it("§4.6: blocks a range exceeding the document's real page count, with a specific message", () => {
    const message = validatePageSelection({ mode: "range", from: 1, to: 11 }, 10);
    expect(message).not.toBeNull();
    expect(message).toContain("10");
  });

  it("blocks a range starting before page 1", () => {
    expect(validatePageSelection({ mode: "range", from: 0, to: 5 }, 10)).not.toBeNull();
  });
});

describe("fetchMatchingShops", () => {
  const baseConfig = { paperSize: "A4" as const, color: "BW" as const, sides: "SINGLE" as const };

  it("requests only paper by default, and returns the parsed shop list", async () => {
    let requestedUrl = "";
    const shops: ShopListItem[] = [
      {
        id: "shop-1",
        name: "Test Shop",
        address: "1 Test St",
        status: "OPEN",
        capabilities: { color: false, duplex: false, a4: true, a3: false },
        distanceKm: null,
        estimatedProcessingTimeMinutes: null,
      },
    ];
    const fetchImpl = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return jsonResponse(200, shops);
    }) as unknown as typeof fetch;

    const result = await fetchMatchingShops(baseConfig, fetchImpl);

    expect(requestedUrl).toContain("paper=A4");
    expect(requestedUrl).not.toContain("color=");
    expect(requestedUrl).not.toContain("duplex=");
    expect(result).toEqual(shops);
  });

  it("adds color=true and duplex=true only when the configuration actually needs them", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return jsonResponse(200, []);
    }) as unknown as typeof fetch;

    await fetchMatchingShops({ paperSize: "A4", color: "COLOR", sides: "DOUBLE" }, fetchImpl);

    expect(requestedUrl).toContain("color=true");
    expect(requestedUrl).toContain("duplex=true");
  });

  it("throws when the shop list request fails", async () => {
    const fetchImpl = (async () => jsonResponse(500, {})) as unknown as typeof fetch;
    await expect(fetchMatchingShops(baseConfig, fetchImpl)).rejects.toThrow(
      "Could not load shops.",
    );
  });
});

describe("fetchQuote", () => {
  const config = {
    pages: { mode: "all" as const },
    copies: 1,
    paperSize: "A4" as const,
    color: "BW" as const,
    sides: "SINGLE" as const,
    orientation: "PORTRAIT" as const,
  };

  it("posts to the authenticated proxy and returns the parsed quote", async () => {
    const quote: QuoteResult = {
      lineItems: [{ label: "Page price", amountMinor: 1000 }],
      subtotalMinor: 1000,
      platformFeeMinor: 200,
      totalMinor: 1200,
      currency: "PKR",
    };
    let requestedPath = "";
    let requestedBody: unknown;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedPath = String(url);
      requestedBody = init?.body !== undefined ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse(200, quote);
    }) as unknown as typeof fetch;

    const result = await fetchQuote("doc-1", "shop-1", config, fetchImpl);

    expect(requestedPath).toBe("/api/orders/quote");
    expect(requestedBody).toEqual({
      documentId: "doc-1",
      shopId: "shop-1",
      printConfiguration: config,
    });
    expect(result).toEqual(quote);
  });

  it("surfaces the server's own error message on failure, e.g. the S4.6 page-range refusal", async () => {
    const fetchImpl = (async () =>
      jsonResponse(400, {
        error_code: "INVALID_PAGE_SELECTION",
        message: "Page range to=11 exceeds the document's 10 pages.",
        retryable: false,
        request_id: "req-1",
      })) as unknown as typeof fetch;

    await expect(fetchQuote("doc-1", "shop-1", config, fetchImpl)).rejects.toThrow(
      "Page range to=11 exceeds the document's 10 pages.",
    );
  });
});

describe("debounce", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("only runs once, with the latest arguments, after the delay elapses without another call", () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 300);

    debounced("first");
    jest.advanceTimersByTime(100);
    debounced("second");
    jest.advanceTimersByTime(100);
    debounced("third");
    jest.advanceTimersByTime(300);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("third");
  });
});
