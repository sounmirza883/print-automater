import { loadEnv } from "./load-env.js";
import { EnvValidationError } from "./errors.js";
import { apiEnvSchema } from "./schemas/api.js";

const VALID_API_ENV: Record<string, string> = {
  NODE_ENV: "development",
  LOG_LEVEL: "info",
  PORT: "3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5433/print_automated",
  REDIS_URL: "redis://localhost:6380",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  JWT_AGENT_SECRET: "e".repeat(32),
  S3_ENDPOINT: "http://localhost:9010",
  S3_REGION: "us-east-1",
  S3_BUCKET: "print-automated-documents",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  KMS_PROVIDER: "local",
  KMS_LOCAL_MASTER_KEY: "c".repeat(32),
  CORS_ALLOWED_ORIGINS: "http://localhost:3001",
  MOCK_PAYMENT_WEBHOOK_SECRET: "d".repeat(32),
};

describe("loadEnv", () => {
  it("parses a fully valid environment", () => {
    const env = loadEnv(apiEnvSchema, VALID_API_ENV);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain("5433");
  });

  it("fails fast with a readable list of every missing/invalid key, not a runtime undefined", () => {
    // Remove several required vars at once — must NOT throw on the first
    // and stop; every missing/invalid key should be reported together.
    const { JWT_ACCESS_SECRET, DATABASE_URL, ...incomplete } = VALID_API_ENV;
    void JWT_ACCESS_SECRET;
    void DATABASE_URL;

    let caught: unknown;
    try {
      loadEnv(apiEnvSchema, incomplete);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    expect(err.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["JWT_ACCESS_SECRET", "DATABASE_URL"]),
    );
    expect(err.message).toContain("JWT_ACCESS_SECRET");
    expect(err.message).toContain("DATABASE_URL");
  });

  it("TRUST_PROXY_HOPS defaults to 0 (trust no X-Forwarded-For) and accepts a whole hop count", () => {
    expect(loadEnv(apiEnvSchema, VALID_API_ENV).TRUST_PROXY_HOPS).toBe(0);
    expect(
      loadEnv(apiEnvSchema, { ...VALID_API_ENV, TRUST_PROXY_HOPS: "1" }).TRUST_PROXY_HOPS,
    ).toBe(1);
    // Never a blanket "true" (every hop trusted = a client picks its own IP), a
    // negative, or a fraction: fail fast at boot instead.
    for (const bad of ["true", "-1", "1.5", "loopback"]) {
      expect(() => loadEnv(apiEnvSchema, { ...VALID_API_ENV, TRUST_PROXY_HOPS: bad })).toThrow(
        EnvValidationError,
      );
    }
  });

  it("cross-field validates KMS_PROVIDER: local requires KMS_LOCAL_MASTER_KEY", () => {
    const { KMS_LOCAL_MASTER_KEY, ...withoutLocalKey } = VALID_API_ENV;
    void KMS_LOCAL_MASTER_KEY;

    expect(() => loadEnv(apiEnvSchema, withoutLocalKey)).toThrow(EnvValidationError);
  });
});
