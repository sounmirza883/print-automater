import { z } from "zod";
import { baseEnvSchema } from "./base.js";
import { storageEnvSchema, checkStorageEnv } from "./storage.js";

export const workerEnvSchema = baseEnvSchema
  .extend(storageEnvSchema.shape)
  .extend({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CLAMAV_ENABLED: z.coerce.boolean().default(true),
    CLAMAV_HOST: z.string().default("localhost"),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
  })
  .superRefine(checkStorageEnv);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
