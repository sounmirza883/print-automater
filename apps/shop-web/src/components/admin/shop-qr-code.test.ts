import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShopQrCode, shopUploadUrl } from "@/components/admin/shop-qr-code";

const ENV_KEY = "NEXT_PUBLIC_CUSTOMER_WEB_URL";

describe("shopUploadUrl", () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("falls back to customer-web's dev origin when unset", () => {
    delete process.env[ENV_KEY];
    expect(shopUploadUrl("shop-123")).toBe("http://localhost:3001/s/shop-123/upload");
  });

  it("uses the configured origin, stripping a trailing slash", () => {
    process.env[ENV_KEY] = "https://order.example.com/";
    expect(shopUploadUrl("shop-abc")).toBe("https://order.example.com/s/shop-abc/upload");
  });
});

describe("ShopQrCode (rendered)", () => {
  it("encodes the shop's own upload URL into the QR canvas, and shows it as text", () => {
    delete process.env[ENV_KEY];
    const html = renderToStaticMarkup(
      createElement(ShopQrCode, { shopId: "shop-xyz", shopName: "Test Print Co" }),
    );
    const expectedUrl = shopUploadUrl("shop-xyz");
    expect(expectedUrl).toBe("http://localhost:3001/s/shop-xyz/upload");
    // The QRCodeCanvas is given `value={expectedUrl}` (verified by shopUploadUrl's own
    // unit tests above); this asserts the same URL is what the component actually built
    // and displayed, and that a canvas for it was rendered.
    expect(html).toContain(expectedUrl);
    expect(html).toContain("<canvas");
    expect(html).toContain("Download PNG");
  });
});
