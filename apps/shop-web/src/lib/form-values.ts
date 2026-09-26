/** Turning what a person typed into what the API accepts, and back. Pure and
 * unit-tested: a wrong conversion here is a wrong price or a rejected save. */

/** Blank -> undefined (leave the field out of a create). */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Blank -> null (clear the field in an update). */
export function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A whole number in [min, max]; anything else (blank, decimals, junk) is
 * `undefined` so the form can show "enter a whole number". */
export function parseWholeNumber(
  value: string,
  { min = 0, max = 100_000_000 }: { min?: number; max?: number } = {},
): number | undefined {
  const trimmed = value.trim();
  if (!/^-?\d{1,12}$/.test(trimmed)) {
    return undefined;
  }
  const number = Number(trimmed);
  return number >= min && number <= max ? number : undefined;
}

/** "18" or "17.5" (percent) -> basis points (1800, 1750). Blank -> null
 * (no rate). More than two decimals, negatives, junk, over 100% -> undefined. */
export function percentToBasisPoints(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : undefined;
}

/** 1750 -> "17.5"; 1800 -> "18"; null -> "". */
export function basisPointsToPercent(bps: number | null): string {
  if (bps === null) {
    return "";
  }
  return String(bps / 100);
}

/** The keys of `next` whose values differ from `previous` (deep for plain
 * JSON): the smallest PATCH body. */
export function changedFields<T extends Record<string, unknown>>(previous: T, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      out[key] = next[key];
    }
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
