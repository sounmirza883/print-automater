import { z } from "zod";
import { baseEnvSchema } from "./base.js";
import { storageEnvSchema, checkStorageEnv } from "./storage.js";

export const apiEnvSchema = baseEnvSchema
  .extend(storageEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    // §75: a separate secret from the human-user access/refresh pair
    // above -- an agent JWT's payload shape (deviceId, not a user id +
    // role) and its own short TTL are a distinct credential type, not
    // a variant of the same one; a leaked human secret must never be
    // enough to forge an agent token, or vice versa.
    JWT_AGENT_SECRET: z.string().min(32),
    CORS_ALLOWED_ORIGINS: z.string().min(1),
    // S19's formula names a platform fee as its own term, applied on
    // top of every shop's own pricing -- platform-wide, not a shop
    // property, hence a plain config value rather than a DB table.
    // Defaults to 0 (no fee) rather than a fabricated nonzero number
    // for deployments that haven't set a real business decision here.
    PLATFORM_FEE_MINOR: z.coerce.number().int().nonnegative().default(0),
    // §23/6.2: which PaymentProvider is bound to the PAYMENT_PROVIDER
    // DI token. Only "mock" exists until a real PSP adapter is added
    // later (one new enum value + one new class, per 6.2's own
    // Done-when) -- not a union of everything the codebase might ever
    // support, since that would let a typo silently fall through to
    // whatever `.default()` picks rather than failing fast at startup.
    PAYMENT_PROVIDER: z.enum(["mock"]).default("mock"),
    // HMAC-SHA256 key MockPaymentProvider signs its (genuinely
    // real-HTTP-delivered) webhooks with, and the same key
    // verifyWebhook() checks them against -- min(32) matches the JWT
    // secrets' own bar for a symmetric key that guards financial state
    // transitions.
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().min(32),
    // Where this API is reachable from a browser or from itself --
    // MockPaymentProvider's checkout page links and its own webhook
    // delivery both need an absolute URL, not a relative path, since
    // the former is opened directly by a browser and the latter is a
    // genuine outbound HTTP call.
    API_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  })
  .superRefine(checkStorageEnv);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
