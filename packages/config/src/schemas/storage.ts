import { z } from "zod";

/**
 * Shared by any service that reads/writes documents (api, worker):
 * S3-compatible object storage plus the envelope-encryption key manager
 * (§62 — local master key in dev, AWS KMS in prod).
 *
 * Kept as a plain ZodObject (no .superRefine here) so it stays
 * `.extend()`-able when composed into a larger per-service schema.
 * The KMS_PROVIDER cross-field check lives in `checkStorageEnv`, which
 * each composed schema's own top-level `.superRefine()` calls.
 */
export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  KMS_PROVIDER: z.enum(["local", "aws"]).default("local"),
  KMS_LOCAL_MASTER_KEY: z.string().min(32).optional(),
  KMS_AWS_KEY_ID: z.string().optional(),
});

export type StorageEnv = z.infer<typeof storageEnvSchema>;

export function checkStorageEnv(value: StorageEnv, ctx: z.RefinementCtx): void {
  if (value.KMS_PROVIDER === "local" && !value.KMS_LOCAL_MASTER_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["KMS_LOCAL_MASTER_KEY"],
      message: "required when KMS_PROVIDER=local",
    });
  }
  if (value.KMS_PROVIDER === "aws" && !value.KMS_AWS_KEY_ID) {
    ctx.addIssue({
      code: "custom",
      path: ["KMS_AWS_KEY_ID"],
      message: "required when KMS_PROVIDER=aws",
    });
  }
}
