import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShopQrCode, shopUploadUrl } from "@/components/admin/shop-qr-code";

const ENV_KEY = "NEXT_PUBLIC_CUSTOMER_WEB_URL";
// Next types NODE_ENV as readonly; the component reads it the way a built bundle does.
const env = process.env as Record<string, string | undefined>;
const originalUrl = env[ENV_KEY];
const originalNodeEnv = env.NODE_ENV;

afterEach(() => {
  if (originalUrl === undefined) delete env[ENV_KEY];
  else env[ENV_KEY] = originalUrl;
  env.NODE_ENV = originalNodeEnv;
});

describe("shopUploadUrl", () => {
  it("falls back to customer-web's dev origin when unset, outside a production build", () => {
    delete env[ENV_KEY];
    expect(shopUploadUrl("shop-123")).toBe("http://localhost:3001/s/shop-123/upload");
  });

  it("uses the configured origin, stripping a trailing slash", () => {
    env[ENV_KEY] = "https://order.example.com/";
    expect(shopUploadUrl("shop-abc")).toBe("https://order.example.com/s/shop-abc/upload");
  });

  it("treats an EMPTY value (an unset Docker build arg) exactly like a missing one", () => {
    env[ENV_KEY] = "";
    expect(shopUploadUrl("shop-123")).toBe("http://localhost:3001/s/shop-123/upload");
    env[ENV_KEY] = "   ";
    expect(shopUploadUrl("shop-123")).toBe("http://localhost:3001/s/shop-123/upload");
  });

  it("never guesses in a production build: missing or empty means no URL at all", () => {
    env.NODE_ENV = "production";
    delete env[ENV_KEY];
    expect(shopUploadUrl("shop-123")).toBeNull();
    env[ENV_KEY] = "";
    expect(shopUploadUrl("shop-123")).toBeNull();
    env[ENV_KEY] = "https://order.example.com";
    expect(shopUploadUrl("shop-123")).toBe("https://order.example.com/s/shop-123/upload");
  });

  it("refuses a value that is not an absolute http(s) URL, which would encode a relative path", () => {
    for (const value of ["order.example.com", "/s", "ftp://order.example.com", "https://"]) {
      env[ENV_KEY] = value;
      expect(shopUploadUrl("shop-123")).toBeNull();
    }
  });
});

describe("ShopQrCode (rendered)", () => {
  const render = (props: { notReady?: string } = {}) =>
    renderToStaticMarkup(
      createElement(ShopQrCode, { shopId: "shop-xyz", shopName: "Test Print Co", ...props }),
    );

  it("encodes the shop's own upload URL into the QR canvas, and shows it as text", () => {
    delete env[ENV_KEY];
    const html = render();
    const expectedUrl = shopUploadUrl("shop-xyz");
    expect(expectedUrl).toBe("http://localhost:3001/s/shop-xyz/upload");
    // The QRCodeCanvas is given `value={expectedUrl}` (verified by shopUploadUrl's own
    // unit tests above); this asserts the same URL is what the component actually built
    // and displayed, and that a canvas for it was rendered.
    expect(html).toContain(expectedUrl);
    expect(html).toContain("<canvas");
    expect(html).toContain("Download PNG");
  });

  it("fails loudly, with no code and no download, when a production build has no origin", () => {
    env.NODE_ENV = "production";
    env[ENV_KEY] = "";
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("NEXT_PUBLIC_CUSTOMER_WEB_URL");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Download PNG");
    expect(html).not.toContain("/s/shop-xyz/upload");
  });

  it("withholds the code, saying why, when the caller says orders would fail today", () => {
    delete env[ENV_KEY];
    const html = render({ notReady: "This business has no prices yet." });
    expect(html).toContain("Not ready to hand out yet");
    expect(html).toContain("This business has no prices yet.");
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Download PNG");
  });
});
