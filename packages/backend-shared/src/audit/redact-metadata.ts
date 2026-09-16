const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "authorization",
  // 12.3: no current call site passes either of these into metadata
  // (checked directly, not assumed) -- widened defensively for this
  // system's own specific threat model: signature is the agent's own
  // Ed25519 proof-of-possession (§41/9.3), and privatekey guards
  // against a future caller accidentally logging local key material
  // (identity-store.ts's own private key never leaves the agent
  // process today, but nothing stops a future audit call from
  // including one by mistake).
  "signature",
  "privatekey",
]);

const REDACTED = "[REDACTED]";

/** §83: "Never put secrets into audit logs." Recursively walks arbitrary
 * caller-supplied metadata and replaces any value whose key looks
 * sensitive, so a caller that accidentally includes a password/token in
 * metadata can't leak it into the audit trail. */
export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMetadata);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactMetadata(val);
    }
    return result;
  }
  return value;
}
