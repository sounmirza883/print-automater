const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "authorization",
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
