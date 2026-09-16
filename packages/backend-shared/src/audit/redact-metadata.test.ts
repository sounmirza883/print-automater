import { redactMetadata } from "./redact-metadata.js";

describe("redactMetadata", () => {
  it("redacts a top-level password field", () => {
    const result = redactMetadata({ email: "a@b.com", password: "hunter2" });
    expect(result).toEqual({ email: "a@b.com", password: "[REDACTED]" });
  });

  it("redacts sensitive keys regardless of case", () => {
    const result = redactMetadata({ Password: "x", ACCESSTOKEN: "y", RefreshToken: "z" });
    expect(result).toEqual({
      Password: "[REDACTED]",
      ACCESSTOKEN: "[REDACTED]",
      RefreshToken: "[REDACTED]",
    });
  });

  it("redacts sensitive keys nested inside objects and arrays", () => {
    const result = redactMetadata({
      user: { name: "Ada", passwordHash: "abc123" },
      attempts: [{ token: "t1" }, { token: "t2" }],
    });
    expect(result).toEqual({
      user: { name: "Ada", passwordHash: "[REDACTED]" },
      attempts: [{ token: "[REDACTED]" }, { token: "[REDACTED]" }],
    });
  });

  it("§85/12.3: redacts a signature and a privateKey, this system's own domain-specific secrets", () => {
    const result = redactMetadata({
      deviceId: "device-1",
      signature: "base64-ed25519-signature",
      privateKey: "pem-encoded-key-material",
    });
    expect(result).toEqual({
      deviceId: "device-1",
      signature: "[REDACTED]",
      privateKey: "[REDACTED]",
    });
  });

  it("leaves non-sensitive fields untouched", () => {
    const result = redactMetadata({ orderId: "abc", pages: 10, colors: ["red", "blue"] });
    expect(result).toEqual({ orderId: "abc", pages: 10, colors: ["red", "blue"] });
  });
});
