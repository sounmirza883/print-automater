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
    CORS_ALLOWED_ORIGINS: z.string().min(1),
    // S19's formula names a platform fee as its own term, applied on
    // top of every shop's own pricing -- platform-wide, not a shop
    // property, hence a plain config value rather than a DB table.
    // Defaults to 0 (no fee) rather than a fabricated nonzero number
    // for deployments that haven't set a real business decision here.
    PLATFORM_FEE_MINOR: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine(checkStorageEnv);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
