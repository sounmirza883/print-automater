export type ClassValue = string | number | false | null | undefined | ClassValue[];

/** Joins truthy class values (strings, nested arrays) with single spaces. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const v of values) {
    if (Array.isArray(v)) {
      const inner = cn(...v);
      if (inner) out.push(inner);
    } else if (v || v === 0) {
      out.push(String(v));
    }
  }
  return out.join(" ");
}
