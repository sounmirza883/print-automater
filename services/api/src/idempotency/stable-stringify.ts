/** A deterministic `JSON.stringify` -- object keys are sorted, so two
 * request bodies that are semantically identical but were serialized
 * with keys in a different order (a real thing across different HTTP
 * clients/languages) hash the same. Not a security boundary (nothing
 * here defends against a body deliberately crafted to collide) --
 * this only needs to catch honest client-side retries and accidental
 * key reuse, per §92. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
