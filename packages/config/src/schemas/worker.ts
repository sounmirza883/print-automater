import { z } from "zod";
import { baseEnvSchema, zBooleanString } from "./base.js";
import { storageEnvSchema, checkStorageEnv } from "./storage.js";

export const workerEnvSchema = baseEnvSchema
  .extend(storageEnvSchema.shape)
  .extend({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CLAMAV_ENABLED: zBooleanString(true),
    CLAMAV_HOST: z.string().default("localhost"),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    // 14.5: only meaningful when EMAIL_TRANSPORT=smtp -- most real
    // relays require AUTH LOGIN/PLAIN; MailHog (the dev/placeholder
    // default) requires neither, so these stay optional rather than
    // required the way checkStorageEnv's KMS fields are.
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    // TLS-on-connect (SMTPS, typically port 465) vs. plain/STARTTLS
    // (typically 587 or 25, nodemailer's own `secure: false` default).
    SMTP_SECURE: zBooleanString(false),
    // §78/7.2, extended 14.5: which EmailTransport is bound to
    // EMAIL_TRANSPORT -- "mailhog" (dev, real SMTP to the local
    // container), "smtp" (prod default: any standards-compliant SMTP
    // relay via SmtpEmailTransport, no AWS required -- 14.5's whole
    // point) or "ses" (prod, real AWS SES via S3_REGION's same AWS
    // account/region, still available for anyone who wants to keep
    // using it).
    EMAIL_TRANSPORT: z.enum(["mailhog", "smtp", "ses"]).default("mailhog"),
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
    // §66/§67/11.5: how long a completed order's document survives
    // before the retention sweep erases it. 30 days is a placeholder
    // default, not a researched business/legal retention requirement --
    // easy to retune later since nothing else depends on this exact
    // figure.
    DOCUMENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    // 21.10: DOCX -> PDF via LibreOffice headless in the worker. Disable to
    // reject every DOCX with a clear "cannot convert right now" reason.
    // SOFFICE_PATH is the binary (the worker image installs it on PATH).
    // The timeout is a hard wall-clock kill for one conversion.
    DOCX_CONVERSION_ENABLED: zBooleanString(true),
    SOFFICE_PATH: z.string().min(1).default("soffice"),
    DOCX_CONVERSION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  })
  .superRefine(checkStorageEnv);

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
