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
    // §108: how long an order may sit in PAYMENT_PENDING before 5.6's
    // sweep expires it. 30 minutes is a placeholder default, not a
    // researched business number -- there's nothing in the PRD pinning
    // an exact figure, and it's easy to retune later since nothing else
    // depends on this specific value.
    ORDER_PAYMENT_PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  })
  .superRefine(checkStorageEnv);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
