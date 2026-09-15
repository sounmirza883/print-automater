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
  })
  .superRefine(checkStorageEnv);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
