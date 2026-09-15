import { createHash } from "node:crypto";

/** Deterministic hash of an opaque bearer token before it's persisted.
 * Used for refresh tokens (1.4) and password-reset tokens (1.5) alike --
 * the raw token is never stored, only this. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
