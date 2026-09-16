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
    // §78/7.2: which EmailTransport is bound to EMAIL_TRANSPORT --
    // "mailhog" (dev, real SMTP to the local container) or "ses"
    // (prod, real AWS SES via S3_REGION's same AWS account/region).
    EMAIL_TRANSPORT: z.enum(["mailhog", "ses"]).default("mailhog"),
    EMAIL_FROM_ADDRESS: z.string().email().default("no-reply@print-automated.dev"),
    // §108: how long an order may sit in PAYMENT_PENDING before 5.6's
    // sweep expires it. 30 minutes is a placeholder default, not a
    // researched business number -- there's nothing in the PRD pinning
    // an exact figure, and it's easy to retune later since nothing else
    // depends on this specific value.
    ORDER_PAYMENT_PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    // §109: how long an order may sit in QUEUED_FOR_PRINT with no agent
    // response (never claimed, or claimed but never reported back)
    // before 10.5's sweep gives up on it. Much shorter than the payment
    // TTL above -- an agent that's actually online claims within
    // seconds, not minutes -- but still a placeholder default, not a
    // researched business number.
    PRINT_JOB_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(10),
  })
  .superRefine(checkStorageEnv);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
